import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@shared/index';
import { generateProgression } from '../harmony';
import { MOODS } from '../moods';
import { stream } from '../rng';
import { padStyle, renderPad } from './pad';
import type { LayerContext } from './context';
import type { SectionPlan } from '../plan';

function minimalPlan(overrides: Partial<SectionPlan> = {}): SectionPlan {
  const mood = MOODS.dreamy;
  const key = { tonic: 0, scale: 'ionian' as const };
  const prog = generateProgression(key, mood, stream(1, 't'));
  return {
    index: 0,
    name: 'Drift',
    mood: 'dreamy',
    startBar: 0,
    lengthBars: 16,
    curveBars: 16,
    key,
    progression: prog,
    voicings: prog.chords.map(() => [48, 55, 62, 69]),
    bassRoots: prog.chords.map((c) => 36 + c.rootPc),
    energy: { from: 0.4, start: 0.4, end: 0.5 },
    layers: { pad: [[0, 16]], texture: [[0, 16]], arp: [], bass: [], lead: [], drums: [], bell: [] },
    joinsPrev: { pad: false, texture: false, arp: false, bass: false, lead: false, drums: false, bell: false },
    leavesAtEnd: { pad: false, texture: false, arp: false, bass: false, lead: false, drums: false, bell: false },
    motifIds: [],
    drumTierCap: 2,
    arpFamily: 'updown',
    bassPedal: false,
    songIndex: 0,
    ...overrides,
  };
}

function ctxFor(plan: SectionPlan, seed: number, songIndex: number): LayerContext {
  return {
    seed,
    plan: { ...plan, songIndex },
    fromBar: 0,
    toBar: plan.lengthBars,
    params: { ...DEFAULT_PARAMS, variation: 0.85 },
    bank: { motifs: [], nextId: 0 },
    cache: new Map(),
  };
}

describe('pad layer', () => {
  it('picks different articulation styles for different songs (seed)', () => {
    const plan = minimalPlan();
    const a = padStyle(ctxFor(plan, 100, 0));
    const b = padStyle(ctxFor(plan, 200, 1));
    const styles = new Set([a.articulation, b.articulation]);
    expect(styles.size).toBeGreaterThanOrEqual(1);
    expect(['legato', 'stagger', 'pulse', 'block']).toContain(a.articulation);
  });

  it('stagger articulation offsets pad onsets within a chord', () => {
    const plan = minimalPlan({ lengthBars: 8 });
    const cache = new Map<string, unknown>([[`pad.style:0`, { articulation: 'stagger' }]]);
    const ctx: LayerContext = { ...ctxFor(plan, 42, 0), cache };
    const notes = renderPad(ctx);
    expect(notes.some((n) => n.beat >= 0.24 && n.beat <= 0.76)).toBe(true);
  });

  it('pulse articulation emits bar-sized pad chunks', () => {
    const plan = minimalPlan({ lengthBars: 16 });
    const cache = new Map<string, unknown>([[`pad.style:0`, { articulation: 'pulse' }]]);
    const ctx: LayerContext = { ...ctxFor(plan, 42, 0), cache };
    const notes = renderPad(ctx);
    const longHeld = notes.filter((n) => n.durBeats > 4.5);
    expect(longHeld.length).toBeLessThan(notes.length);
  });
});
