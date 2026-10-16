import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TUNING_KEYS_PER_MOOD,
  TUNING_KEY,
  loadTuning,
  parseTuning,
  sanitizeTuning,
  saveTuning,
  serializeTuning,
  startTuningPersistence,
  type StorageLike,
  type TuningState,
  type TuningPersistableStore,
} from './presets';

function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('tuning key', () => {
  it('uses the documented localStorage key', () => {
    expect(TUNING_KEY).toBe('ghost-frequency:tuning:v1');
  });
});

describe('sanitizeTuning', () => {
  it('keeps known moods with finite numbers', () => {
    expect(sanitizeTuning({ dreamy: { 'arp.cutoffMax': 4000, 'fx.reverbSend.arp': 0.3 }, dark: { 'bass.drive': 0 } })).toEqual({
      dreamy: { 'arp.cutoffMax': 4000, 'fx.reverbSend.arp': 0.3 },
      dark: { 'bass.drive': 0 },
    });
  });

  it('drops unknown moods, non-finite values and malformed entries', () => {
    const out = sanitizeTuning({
      vaporwave: { a: 1 },
      dreamy: { ok: 1, nan: NaN, inf: Infinity, str: '3', nul: null, obj: {}, arr: [1] },
      dark: 'nope',
      space: [1, 2],
      nostalgic: {},
    });
    expect(out).toEqual({ dreamy: { ok: 1 } });
  });

  it('keeps keys that are not in any schema (schema-independent)', () => {
    expect(sanitizeTuning({ space: { 'some.removedParam': 5 } })).toEqual({ space: { 'some.removedParam': 5 } });
  });

  it('rejects dangerous or malformed key names', () => {
    const src = JSON.parse('{"dreamy":{"__proto__":1,"constructor":2,"has space":3,"":4,"good":5}}') as unknown;
    const out = sanitizeTuning(src);
    expect(out).toEqual({ dreamy: { good: 5 } });
    expect(Object.getPrototypeOf(out!.dreamy)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects over-long keys and caps keys per mood', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < MAX_TUNING_KEYS_PER_MOOD + 50; i++) many[`k${i}`] = i;
    many['x'.repeat(200)] = 1;
    const out = sanitizeTuning({ dreamy: many });
    expect(Object.keys(out!.dreamy!).length).toBe(MAX_TUNING_KEYS_PER_MOOD);
    expect(Object.keys(out!.dreamy!).some((k) => k.length > 80)).toBe(false);
  });

  it('returns null for non-objects', () => {
    expect(sanitizeTuning(null)).toBeNull();
    expect(sanitizeTuning(5)).toBeNull();
    expect(sanitizeTuning([])).toBeNull();
  });
});

describe('parseTuning / serializeTuning', () => {
  it('round-trips', () => {
    const t: TuningState = { dreamy: { 'arp.cutoffMax': 3200.5 }, space: { 'fx.delayFeedback': 0.4 } };
    const text = serializeTuning(t);
    expect(JSON.parse(text)).toEqual({ version: 1, tuning: t });
    expect(parseTuning(text)).toEqual(t);
  });

  it('returns null for missing, broken, or wrong-version blobs', () => {
    expect(parseTuning(null)).toBeNull();
    expect(parseTuning('')).toBeNull();
    expect(parseTuning('{nope')).toBeNull();
    expect(parseTuning('[]')).toBeNull();
    expect(parseTuning(JSON.stringify({ version: 2, tuning: { dreamy: { a: 1 } } }))).toBeNull();
    expect(parseTuning(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it('drops malformed parts but keeps the rest', () => {
    const text = JSON.stringify({ version: 1, tuning: { dreamy: { a: 1, b: 'x' }, bogus: { c: 1 } } });
    expect(parseTuning(text)).toEqual({ dreamy: { a: 1 } });
  });
});

describe('load / save tuning', () => {
  it('saves then loads', () => {
    const s = memStorage();
    expect(saveTuning({ dark: { 'bass.drive': 0.6 } }, s)).toBe(true);
    expect(s.data[TUNING_KEY]).toBeDefined();
    expect(loadTuning(s)).toEqual({ dark: { 'bass.drive': 0.6 } });
  });

  it('is safe with no / broken storage', () => {
    expect(loadTuning(null)).toBeNull();
    expect(saveTuning({}, null)).toBe(false);
    expect(loadTuning(throwingStorage)).toBeNull();
    expect(saveTuning({ dark: { a: 1 } }, throwingStorage)).toBe(false);
    expect(loadTuning(memStorage())).toBeNull();
  });

  it('does not touch the presets / last keys', () => {
    const s = memStorage();
    saveTuning({ dark: { a: 1 } }, s);
    expect(Object.keys(s.data)).toEqual([TUNING_KEY]);
  });
});

describe('startTuningPersistence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeStore(initial: TuningState) {
    let state = { tuning: initial };
    const listeners = new Set<(s: typeof state, p: typeof state) => void>();
    const store: TuningPersistableStore = {
      getState: () => state,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    return {
      store,
      set(tuning: TuningState, extra: Record<string, unknown> = {}) {
        const prev = state;
        state = { ...state, ...extra, tuning };
        for (const l of listeners) l(state, prev);
      },
      touchOther() {
        const prev = state;
        state = { ...state };
        for (const l of listeners) l(state, prev);
      },
      listeners,
    };
  }

  it('debounces saves and writes the latest tuning', () => {
    vi.useFakeTimers();
    const s = memStorage();
    const f = fakeStore({});
    startTuningPersistence(f.store, s, 500);
    f.set({ dreamy: { a: 1 } });
    f.set({ dreamy: { a: 2 } });
    vi.advanceTimersByTime(499);
    expect(s.data[TUNING_KEY]).toBeUndefined();
    vi.advanceTimersByTime(2);
    expect(loadTuning(s)).toEqual({ dreamy: { a: 2 } });
  });

  it('ignores updates that leave tuning untouched', () => {
    vi.useFakeTimers();
    const s = memStorage();
    const f = fakeStore({});
    startTuningPersistence(f.store, s, 100);
    f.touchOther();
    vi.advanceTimersByTime(1000);
    expect(s.data[TUNING_KEY]).toBeUndefined();
  });

  it('flush writes immediately; stop cancels and unsubscribes', () => {
    vi.useFakeTimers();
    const s = memStorage();
    const f = fakeStore({});
    const p = startTuningPersistence(f.store, s, 500);
    f.set({ space: { z: 3 } });
    p.flush();
    expect(loadTuning(s)).toEqual({ space: { z: 3 } });

    f.set({ space: { z: 4 } });
    p.stop();
    vi.advanceTimersByTime(1000);
    expect(loadTuning(s)).toEqual({ space: { z: 3 } });
    expect(f.listeners.size).toBe(0);
  });
});
