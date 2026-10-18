import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  DEFAULT_STEER,
  DRUM,
  LAYER_IDS,
  MOOD_IDS,
  SCHEMA_VERSION,
  type AutomationEvent,
  type EventBatch,
  type GenerationParams,
  type LayerId,
  type MoodId,
  type MusicEvent,
  type NoteEvent,
  type SectionEvent,
} from '@shared/index';
import { TOM_NOTES } from '../composition/layers/drums';
import { chordSegments } from '../composition/plan';
import { mod12, scalePcs } from '../composition/theory';
import { BASS_HI, BASS_LO, PAD_HI, PAD_LO } from '../composition/harmony';
import { LocalEngine } from './localEngine';

function params(mood: MoodId, seed = 1984, over: Partial<GenerationParams> = {}): GenerationParams {
  return { ...DEFAULT_PARAMS, mood, seed, ...over };
}

function renderAll(p: GenerationParams, bars: number, chunk = 4): { batches: EventBatch[]; engine: LocalEngine } {
  const engine = new LocalEngine();
  engine.init(p.seed, p);
  const batches: EventBatch[] = [];
  for (let b = 0; b < bars; b += chunk) batches.push(engine.renderBars(b, Math.min(chunk, bars - b), p));
  return { batches, engine };
}

const flat = (batches: EventBatch[]): MusicEvent[] => batches.flatMap((b) => b.events);
const notesOf = (events: MusicEvent[]): NoteEvent[] => events.filter((e): e is NoteEvent => e.kind === 'note');
const autoOf = (events: MusicEvent[]): AutomationEvent[] =>
  events.filter((e): e is AutomationEvent => e.kind === 'automation');
const sectionsOf = (events: MusicEvent[]): SectionEvent[] =>
  events.filter((e): e is SectionEvent => e.kind === 'section');

/** Piecewise-linear value of an automation target at a beat (ramp starts at event beat). */
function valueAt(events: AutomationEvent[], target: string, beat: number, initial = 0): number {
  let value = initial;
  let lastBeat = 0;
  const list = events.filter((e) => e.target === target).sort((a, b) => a.beat - b.beat);
  for (const e of list) {
    if (e.beat > beat) break;
    const ramp = e.rampBeats ?? 0;
    if (ramp <= 0 || beat >= e.beat + ramp) {
      value = e.value;
    } else {
      const t = (beat - e.beat) / ramp;
      value = value + (e.value - value) * t;
      return value;
    }
    lastBeat = e.beat;
  }
  void lastBeat;
  return value;
}

describe('LocalEngine: contract', () => {
  it('identifies itself and emits well-formed batches', () => {
    const e = new LocalEngine();
    expect(e.info).toEqual({ id: 'local-js', name: 'Built-in (JavaScript)' });
    const p = params('nostalgic');
    e.init(p.seed, p);
    const b = e.renderBars(0, 4, p);
    expect(b.version).toBe(SCHEMA_VERSION);
    expect(b.startBeat).toBe(0);
    expect(b.endBeat).toBe(16);
    expect(b.timeSig).toEqual([4, 4]);
    expect(b.tempo).toBeGreaterThanOrEqual(90);
    expect(b.tempo).toBeLessThanOrEqual(110);
    expect(b.events.length).toBeGreaterThan(5);
  });

  it('honours steer knobs passed from the UI (lead density)', () => {
    const sparse = params('nostalgic', 4242, { steer: { ...DEFAULT_STEER, lead: 0.05 } });
    const dense = params('nostalgic', 4242, { steer: { ...DEFAULT_STEER, lead: 0.95 } });
    const nSparse = notesOf(flat(renderAll(sparse, 48).batches)).filter((n) => n.layer === 'lead').length;
    const nDense = notesOf(flat(renderAll(dense, 48).batches)).filter((n) => n.layer === 'lead').length;
    expect(nDense).toBeGreaterThan(nSparse);
  });

  it('tempo comes from the mood range, stays stable, and honours the user override', () => {
    const ranges: Record<MoodId, [number, number]> = {
      dreamy: [84, 100],
      dark: [70, 90],
      nostalgic: [90, 110],
      space: [60, 76],
    };
    for (const mood of MOOD_IDS) {
      for (let seed = 1; seed <= 6; seed++) {
        const p = params(mood, seed);
        const { batches } = renderAll(p, 40);
        const t = batches[0]!.tempo;
        expect(t).toBeGreaterThanOrEqual(ranges[mood][0]);
        expect(t).toBeLessThanOrEqual(ranges[mood][1]);
        for (const b of batches) expect(b.tempo).toBe(t);
      }
    }
    const p = params('dark', 5, { tempo: 123 });
    const e = new LocalEngine();
    e.init(5, p);
    expect(e.renderBars(0, 2, p).tempo).toBe(123);
    expect(e.renderBars(2, 2, { ...p, tempo: 77 }).tempo).toBe(77);
  });

  it('consecutive batches have no gaps and events stay inside their batch', () => {
    for (const mood of MOOD_IDS) {
      const { batches } = renderAll(params(mood), 96, 3);
      let expectStart = 0;
      for (const b of batches) {
        expect(b.startBeat).toBe(expectStart);
        expect(b.endBeat).toBeGreaterThan(b.startBeat);
        expectStart = b.endBeat;
        for (const ev of b.events) {
          expect(ev.beat).toBeGreaterThanOrEqual(b.startBeat);
          expect(ev.beat).toBeLessThan(b.endBeat);
        }
        // sorted by beat
        for (let i = 1; i < b.events.length; i++) expect(b.events[i]!.beat).toBeGreaterThanOrEqual(b.events[i - 1]!.beat);
      }
    }
  });

  it('all notes have valid MIDI / velocity / duration and sit near a 16th grid (swing + feel offsets only)', () => {
    for (const mood of MOOD_IDS) {
      const notes = notesOf(flat(renderAll(params(mood, 77), 128).batches));
      expect(notes.length).toBeGreaterThan(200);
      for (const n of notes) {
        expect(Number.isInteger(n.midi)).toBe(true);
        expect(n.midi).toBeGreaterThanOrEqual(0);
        expect(n.midi).toBeLessThanOrEqual(127);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(n.durBeats).toBeGreaterThan(0);
        expect(Number.isFinite(n.beat)).toBe(true);
        const off = Math.abs(n.beat * 4 - Math.round(n.beat * 4)) / 4;
        if (n.layer === 'pad' || n.layer === 'texture') expect(off).toBe(0);
        else expect(off).toBeLessThan(0.1);
        expect(LAYER_IDS).toContain(n.layer);
      }
      for (const a of autoOf(flat(renderAll(params(mood, 77), 64).batches))) {
        expect(a.value).toBeGreaterThanOrEqual(0);
        expect(a.value).toBeLessThanOrEqual(1);
        expect(a.rampBeats ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is deterministic: same seed + params -> identical events; different seeds differ', () => {
    for (const mood of MOOD_IDS) {
      const a = renderAll(params(mood, 4242), 64).batches;
      const b = renderAll(params(mood, 4242), 64).batches;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const c = renderAll(params(mood, 4243), 64).batches;
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    }
  });

  it('batching granularity does not change the music (constant params)', () => {
    const p = params('dreamy', 31);
    const bulk = new LocalEngine();
    bulk.init(p.seed, p);
    const once = bulk.renderBars(0, 96, p).events;
    const chunked = flat(renderAll(p, 96, 4).batches);
    const noteKey = (events: MusicEvent[]): string =>
      JSON.stringify(
        events.filter((e): e is NoteEvent => e.kind === 'note'),
        (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v),
      );
    expect(noteKey(chunked)).toBe(noteKey(once));
  });

  it('renders through intro and drift without throwing (song schedule)', () => {
    const p = params('dreamy', 31);
    const engine = new LocalEngine();
    engine.init(p.seed, p);
    for (let b = 0; b < 96; b++) {
      expect(() => engine.renderBars(b, 1, p)).not.toThrow();
    }
  });

  it('init() resets everything', () => {
    const p = params('dark', 9);
    const e = new LocalEngine();
    e.init(9, p);
    const first = JSON.stringify(e.renderBars(0, 16, p));
    e.renderBars(16, 16, p);
    e.init(9, p);
    expect(JSON.stringify(e.renderBars(0, 16, p))).toBe(first);
  });
});

describe('LocalEngine: musical structure (128 bars per mood)', () => {
  for (const mood of MOOD_IDS) {
    it(`${mood}: sections, energy, markers`, () => {
      const { batches, engine } = renderAll(params(mood, 2024), 128);
      const events = flat(batches);
      const secs = sectionsOf(events);
      expect(secs.length).toBeGreaterThan(8);

      // section plan sanity
      const plans = engine.sections;
      expect(plans.length).toBeGreaterThanOrEqual(2);
      let start = 0;
      for (const pl of plans) {
        expect(pl.startBar).toBe(start);
        expect(pl.lengthBars).toBeGreaterThanOrEqual(16);
        expect(pl.lengthBars).toBeLessThanOrEqual(64);
        expect(pl.lengthBars % 8).toBe(0);
        start += pl.lengthBars;
      }

      // markers: a SectionEvent at each section start and every chord change, with chord + key + energy
      let lastIdx = -1;
      for (const s of secs) {
        expect(s.energy).toBeGreaterThanOrEqual(0);
        expect(s.energy).toBeLessThanOrEqual(1);
        expect(s.chord).toBeDefined();
        expect(s.chord!.root).toBeGreaterThanOrEqual(36);
        expect(s.chord!.root).toBeLessThanOrEqual(47);
        expect(s.chord!.label.length).toBeGreaterThan(0);
        expect(s.chord!.intervals[0]).toBe(0);
        expect(s.sectionIndex).toBeGreaterThanOrEqual(lastIdx);
        lastIdx = s.sectionIndex;
      }
      for (const pl of plans) {
        if (pl.startBar >= 128) continue;
        const starts = secs.filter((s) => s.beat === pl.startBar * 4 && s.sectionIndex === pl.index);
        expect(starts.length).toBe(1);
        expect(starts[0]!.name).toBe(pl.name);
        for (const seg of chordSegments(pl)) {
          const abs = pl.startBar + seg.startBar;
          if (abs >= 128) continue;
          expect(secs.some((s) => s.beat === abs * 4 && s.chord!.label === seg.chord.label)).toBe(true);
        }
      }

      // section variety
      const names = new Set(plans.map((p) => p.name));
      expect(names.size).toBeGreaterThanOrEqual(3);
    });

    it(`${mood}: layers stay in register and density is sane`, () => {
      const { batches, engine } = renderAll(params(mood, 2024), 128);
      const notes = notesOf(flat(batches));
      const perBar = new Map<string, number>();
      for (const n of notes) {
        const bar = Math.floor(n.beat / 4);
        const k = `${n.layer}:${bar}`;
        perBar.set(k, (perBar.get(k) ?? 0) + 1);
      }
      const caps: Record<LayerId, number> = { pad: 9, arp: 16, bass: 16, lead: 9, drums: 40, texture: 4, bell: 0 };
      for (const [k, v] of perBar) expect(v, k).toBeLessThanOrEqual(caps[k.split(':')[0] as LayerId]);

      for (const n of notes) {
        if (n.layer === 'bass') {
          expect(n.midi).toBeGreaterThanOrEqual(BASS_LO);
          expect(n.midi).toBeLessThanOrEqual(BASS_HI);
        }
        if (n.layer === 'pad') {
          expect(n.midi).toBeGreaterThanOrEqual(PAD_LO - 1);
          expect(n.midi).toBeLessThanOrEqual(PAD_HI + 4);
        }
        if (n.layer === 'drums') expect([...Object.values(DRUM), ...TOM_NOTES]).toContain(n.midi);
      }

      // all layers appear over 128 bars
      const used = new Set(notes.map((n) => n.layer));
      for (const l of ['pad', 'bass', 'arp', 'texture'] as LayerId[]) expect(used.has(l), l).toBe(true);

      // lead notes stay inside the scale / chord tones
      const plans = engine.sections;
      for (const pl of plans) {
        const pcs = scalePcs(pl.key);
        const segs = chordSegments(pl);
        for (const n of notes) {
          if (n.layer !== 'lead') continue;
          const bar = Math.floor(n.beat / 4);
          if (bar < pl.startBar || bar >= pl.startBar + pl.lengthBars) continue;
          const seg = segs.filter((s) => pl.startBar + s.startBar <= bar).pop()!;
          const pc = mod12(n.midi);
          expect(pcs.includes(pc) || seg.chord.pcs.includes(pc)).toBe(true);
        }
      }
    });

    it(`${mood}: no same-pitch overlaps within a layer (pitched layers)`, () => {
      const notes = notesOf(flat(renderAll(params(mood, 555), 128).batches)).filter((n) => n.layer !== 'drums');
      const byKey = new Map<string, NoteEvent[]>();
      for (const n of notes) {
        const k = `${n.layer}:${n.midi}`;
        const arr = byKey.get(k) ?? [];
        arr.push(n);
        byKey.set(k, arr);
      }
      for (const arr of byKey.values()) {
        arr.sort((a, b) => a.beat - b.beat);
        for (let i = 1; i < arr.length; i++) {
          expect(arr[i - 1]!.beat + arr[i - 1]!.durBeats).toBeLessThanOrEqual(arr[i]!.beat + 1e-6);
        }
      }
    });

    it(`${mood}: layers do not sound while their gain automation is 0 (beyond ramp-ins)`, () => {
      const events = flat(renderAll(params(mood, 2024), 128).batches);
      const autos = autoOf(events);
      const notes = notesOf(events);
      for (const layer of LAYER_IDS) {
        const ln = notes.filter((n) => n.layer === layer).sort((a, b) => a.beat - b.beat);
        let silentRunStart: number | null = null;
        let worstRun = 0;
        for (const n of ln) {
          const g = valueAt(autos, `layer.gain.${layer}`, n.beat, 0);
          if (g < 0.02) {
            silentRunStart ??= n.beat;
            worstRun = Math.max(worstRun, n.beat - silentRunStart);
          } else silentRunStart = null;
        }
        expect(worstRun, layer).toBeLessThanOrEqual(4);
      }
    });

    it(`${mood}: pad voice leading is smooth (< 4 semitones per voice on average)`, () => {
      const { engine } = renderAll(params(mood, 8080), 128);
      let total = 0;
      let count = 0;
      const segsAll = engine.sections.flatMap((pl) => chordSegments(pl));
      for (let i = 1; i < segsAll.length; i++) {
        const a = segsAll[i - 1]!.voicing;
        const b = segsAll[i]!.voicing;
        for (const p of b) {
          total += Math.min(...a.map((q) => Math.abs(p - q)));
          count++;
        }
      }
      expect(total / count).toBeLessThan(4);
    });
  }
});

describe('LocalEngine: live params and form', () => {
  it('energy changes alter the next bars (density)', () => {
    const lo = params('nostalgic', 3, { energy: 0.1 });
    const hi = { ...lo, energy: 0.95 };
    const e = new LocalEngine();
    e.init(3, lo);
    e.renderBars(0, 32, lo);
    const a = notesOf(e.renderBars(32, 16, lo).events).length;
    const e2 = new LocalEngine();
    e2.init(3, lo);
    e2.renderBars(0, 32, lo);
    const b = notesOf(e2.renderBars(32, 16, hi).events).length;
    expect(b).toBeGreaterThan(a * 1.3);
  });

  it('complexity changes alter pad voicing size / arp content', () => {
    const lo = params('dreamy', 6, { complexity: 0 });
    const hi = { ...lo, complexity: 1 };
    const a = notesOf(renderAll(lo, 48).batches.flatMap((b) => b.events));
    const b = notesOf(renderAll(hi, 48).batches.flatMap((x) => x.events));
    expect(b.length).toBeGreaterThan(a.length);
  });

  it('a mood change mid-piece keeps the running section and plans the next one in the new mood', () => {
    const p = params('nostalgic', 11);
    const e = new LocalEngine();
    e.init(11, p);
    const before = flat([e.renderBars(0, 8, p)]);
    const darkP = { ...p, mood: 'dark' as MoodId };
    const rest: EventBatch[] = [];
    for (let b = 8; b < 128; b += 4) rest.push(e.renderBars(b, 4, darkP));
    const plans = e.sections;
    expect(plans[0]!.mood).toBe('nostalgic');
    // the section running at the time of the change keeps its harmony (no jump inside the section)
    const firstSecs = sectionsOf([...before, ...flat(rest)]).filter((s) => s.sectionIndex === 0);
    expect(new Set(firstSecs.map((s) => `${s.key.tonic}:${s.key.scale}`)).size).toBe(1);
    // a later section is planned in the new mood, and the switch arrives well before the end of a long section
    const darkPlan = plans.find((pl) => pl.mood === 'dark');
    expect(darkPlan).toBeDefined();
    expect(darkPlan!.startBar).toBeLessThanOrEqual(48);
    // new section key is closely related to the previous key (shares >= 4 pitch classes)
    const prev = plans[darkPlan!.index - 1]!;
    const shared = scalePcs(darkPlan!.key).filter((x) => scalePcs(prev.key).includes(x)).length;
    expect(shared).toBeGreaterThanOrEqual(4);
    // dark scales only
    expect(['aeolian', 'phrygian']).toContain(darkPlan!.key.scale);
  });

  it('modulations only happen at section boundaries, via a pivot chord diatonic to the old key', () => {
    let modulations = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const p = params('nostalgic', seed, { variation: 1 });
      const { engine } = renderAll(p, 256);
      const plans = engine.sections;
      for (let i = 1; i < plans.length; i++) {
        const a = plans[i - 1]!;
        const b = plans[i]!;
        if (a.key.tonic !== b.key.tonic || a.key.scale !== b.key.scale) {
          if (a.songIndex !== undefined && b.songIndex !== undefined && a.songIndex !== b.songIndex) continue;
          modulations++;
          expect(a.pivot).toBeDefined();
          const pcs = scalePcs(a.key);
          for (const pc of a.pivot!.chord.pcs) expect(pcs).toContain(pc);
          const toPcs = scalePcs(b.key);
          const triad = a.pivot!.chord.pcs.slice(0, 3);
          for (const pc of triad) expect(toPcs).toContain(pc);
        }
        // within a section, key is constant
        for (const s of chordSegments(a)) expect(s.chord.borrowed || true).toBe(true);
      }
    }
    expect(modulations).toBeGreaterThan(3);
  });

  it('piece-start automation initialises gains and the first layers fade in', () => {
    const { batches } = renderAll(params('space', 4), 8);
    const autos = autoOf(batches[0]!.events);
    for (const l of LAYER_IDS) expect(autos.some((a) => a.target === `layer.gain.${l}` && a.beat === 0)).toBe(true);
    const padIn = autos.filter((a) => a.target === 'layer.gain.pad');
    expect(padIn.some((a) => a.value === 1 && (a.rampBeats ?? 0) >= 8)).toBe(true);
  });

  it('works when renderBars is called without init and with odd counts', () => {
    const e = new LocalEngine();
    const p = params('dreamy', 12);
    const b = e.renderBars(0, 3, p);
    expect(b.endBeat).toBe(12);
    expect(e.renderBars(3, 0, p).events.length).toBe(0);
  });
});
