import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MIXER, DEFAULT_PARAMS, type GenerationParams, type MixerParams } from '@shared/index';
import {
  LAST_KEY,
  MAX_PRESETS,
  PRESETS_KEY,
  debounce,
  loadLast,
  loadPresets,
  makePreset,
  parsePresets,
  removePreset,
  sanitizeMixer,
  sanitizeParams,
  saveLast,
  savePresets,
  serializePresets,
  startPersistence,
  toSeed,
  upsertPreset,
  validatePreset,
  type StorageLike,
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
    throw new Error('QuotaExceededError');
  },
};

describe('sanitizeParams', () => {
  it('passes through valid params', () => {
    const p: GenerationParams = { mood: 'dark', energy: 0.2, complexity: 0.9, variation: 0, tempo: 100, seed: 42 };
    expect(sanitizeParams(p)).toEqual(p);
  });

  it('clamps and repairs invalid fields', () => {
    const out = sanitizeParams({ mood: 'bogus', energy: 5, complexity: -2, variation: NaN, tempo: 500, seed: -1 });
    expect(out).toEqual({
      mood: DEFAULT_PARAMS.mood,
      energy: 1,
      complexity: 0,
      variation: DEFAULT_PARAMS.variation,
      tempo: 130,
      seed: 0xffffffff,
    });
  });

  it('keeps tempo null, clamps low tempo, rejects non-numeric tempo', () => {
    expect(sanitizeParams({ ...DEFAULT_PARAMS, tempo: null })?.tempo).toBeNull();
    expect(sanitizeParams({ ...DEFAULT_PARAMS, tempo: 10 })?.tempo).toBe(50);
    expect(sanitizeParams({ ...DEFAULT_PARAMS, tempo: 'fast' })?.tempo).toBe(DEFAULT_PARAMS.tempo);
  });

  it('returns null for non-objects', () => {
    expect(sanitizeParams(null)).toBeNull();
    expect(sanitizeParams('x')).toBeNull();
    expect(sanitizeParams([1])).toBeNull();
  });

  it('toSeed yields integer uint32', () => {
    expect(toSeed(3.9)).toBe(3);
    expect(toSeed(2 ** 32 + 5)).toBe(5);
  });
});

describe('sanitizeMixer', () => {
  it('fills missing and clamps', () => {
    const out = sanitizeMixer({ pad: 2, arp: -1, bass: 'x' });
    expect(out?.pad).toBe(1);
    expect(out?.arp).toBe(0);
    expect(out?.bass).toBe(DEFAULT_MIXER.bass);
    expect(out?.master).toBe(DEFAULT_MIXER.master);
    expect(Object.keys(out ?? {}).sort()).toEqual(Object.keys(DEFAULT_MIXER).sort());
  });
  it('null for junk', () => {
    expect(sanitizeMixer(undefined)).toBeNull();
  });
});

describe('presets', () => {
  const mk = (name: string, seed = 1) =>
    makePreset(name, { ...DEFAULT_PARAMS, seed }, DEFAULT_MIXER, 1000)!;

  it('makePreset trims, rejects empty names', () => {
    expect(makePreset('   ', DEFAULT_PARAMS, DEFAULT_MIXER)).toBeNull();
    expect(mk('  Hello  ').name).toBe('Hello');
  });

  it('round-trips through serialize/parse', () => {
    const list = [mk('A', 1), mk('B', 2)];
    expect(parsePresets(serializePresets(list))).toEqual(list);
  });

  it('drops malformed entries and survives bad JSON', () => {
    const good = mk('Good');
    const text = JSON.stringify([
      good,
      null,
      42,
      { version: 1, name: '', params: good.params, mixer: good.mixer, savedAt: 1 },
      { version: 2, name: 'v2', params: good.params, mixer: good.mixer, savedAt: 1 },
      { version: 1, name: 'noParams', mixer: good.mixer },
      { version: 1, name: 'noMixer', params: good.params },
    ]);
    expect(parsePresets(text)).toEqual([good]);
    expect(parsePresets('{not json')).toEqual([]);
    expect(parsePresets(null)).toEqual([]);
  });

  it('clamps out-of-range values inside stored presets', () => {
    const raw = { version: 1, name: 'x', params: { ...DEFAULT_PARAMS, energy: 9 }, mixer: { ...DEFAULT_MIXER, master: -3 }, savedAt: 5 };
    const p = validatePreset(raw)!;
    expect(p.params.energy).toBe(1);
    expect(p.mixer.master).toBe(0);
  });

  it('parsePresets accepts a single preset object (import)', () => {
    const p = mk('Solo');
    expect(parsePresets(JSON.stringify(p))).toEqual([p]);
  });

  it('upsert replaces same name case-insensitively and caps the list', () => {
    let list = upsertPreset([], mk('Dream', 1));
    list = upsertPreset(list, mk('dream', 2));
    expect(list).toHaveLength(1);
    expect(list[0]!.params.seed).toBe(2);
    let big = [] as ReturnType<typeof upsertPreset>;
    for (let i = 0; i < MAX_PRESETS + 5; i++) big = upsertPreset(big, mk(`p${i}`));
    expect(big).toHaveLength(MAX_PRESETS);
    expect(big[big.length - 1]!.name).toBe(`p${MAX_PRESETS + 4}`);
  });

  it('removePreset', () => {
    const list = [mk('A'), mk('B')];
    expect(removePreset(list, 'a').map((p) => p.name)).toEqual(['B']);
  });

  it('save/load via injected storage', () => {
    const st = memStorage();
    const list = [mk('A')];
    expect(savePresets(list, st)).toBe(true);
    expect(st.data[PRESETS_KEY]).toBeDefined();
    expect(loadPresets(st)).toEqual(list);
  });

  it('handles storage failures and missing storage', () => {
    expect(savePresets([mk('A')], throwingStorage)).toBe(false);
    expect(loadPresets(throwingStorage)).toEqual([]);
    expect(savePresets([], null)).toBe(false);
    expect(loadPresets(null)).toEqual([]);
  });
});

describe('last used', () => {
  it('round trips', () => {
    const st = memStorage();
    const params: GenerationParams = { ...DEFAULT_PARAMS, mood: 'space', tempo: 77 };
    const mixer: MixerParams = { ...DEFAULT_MIXER, pad: 0.1 };
    expect(saveLast(params, mixer, st)).toBe(true);
    expect(loadLast(st)).toEqual({ params, mixer });
  });

  it('rejects garbage and sanitizes', () => {
    expect(loadLast(memStorage({ [LAST_KEY]: 'garbage' }))).toBeNull();
    expect(loadLast(memStorage({ [LAST_KEY]: '{"params":1,"mixer":2}' }))).toBeNull();
    const out = loadLast(memStorage({ [LAST_KEY]: JSON.stringify({ params: { energy: 3 }, mixer: {} }) }));
    expect(out?.params.energy).toBe(1);
    expect(out?.mixer).toEqual(DEFAULT_MIXER);
    expect(loadLast(throwingStorage)).toBeNull();
    expect(saveLast(DEFAULT_PARAMS, DEFAULT_MIXER, throwingStorage)).toBe(false);
  });
});

describe('debounce / startPersistence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounce coalesces calls and supports flush/cancel', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 500);
    d.call();
    d.call();
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    d.call();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('startPersistence saves debounced on params/mixer change only', () => {
    vi.useFakeTimers();
    const st = memStorage();
    let state = { params: { ...DEFAULT_PARAMS }, mixer: { ...DEFAULT_MIXER } };
    const listeners: Array<(s: typeof state, p: typeof state) => void> = [];
    const store = {
      getState: () => state,
      subscribe: (l: (s: typeof state, p: typeof state) => void) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
    };
    const p = startPersistence(store, st, 500);
    const prev = state;
    state = { ...state, params: { ...state.params, energy: 0.9 } };
    listeners.forEach((l) => l(state, prev));
    expect(st.data[LAST_KEY]).toBeUndefined();
    vi.advanceTimersByTime(500);
    expect(loadLast(st)?.params.energy).toBe(0.9);

    // unrelated change (same refs) -> no save
    delete st.data[LAST_KEY];
    listeners.forEach((l) => l(state, state));
    vi.advanceTimersByTime(1000);
    expect(st.data[LAST_KEY]).toBeUndefined();
    p.stop();
    expect(listeners).toHaveLength(0);
  });
});
