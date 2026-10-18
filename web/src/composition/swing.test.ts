import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DEFAULT_STEER, type GenerationParams, type MusicEvent, type NoteEvent } from '@shared/index';
import type { SectionPlan } from './plan';
import { swingAmount, swingPitchedLayers, swingShift } from './swing';

const plan = { swing: 0.3 } as SectionPlan;
const withKnob = (swing: number): GenerationParams => ({ ...DEFAULT_PARAMS, steer: { ...DEFAULT_STEER, swing } });
const n = (layer: NoteEvent['layer'], beat: number): NoteEvent => ({ kind: 'note', layer, beat, durBeats: 0.25, midi: 60, vel: 0.5 });

describe('swing', () => {
  it('knob 0 is straight, 0.5 is the song swing, 1 doubles it', () => {
    expect(swingAmount(plan, withKnob(0))).toBe(0);
    expect(swingAmount(plan, withKnob(0.5))).toBeCloseTo(0.3);
    expect(swingAmount(plan, withKnob(1))).toBeCloseTo(0.6);
  });

  it('only odd 16ths and off-beat 8ths move, and never early', () => {
    expect(swingShift(0, 0.5)).toBe(0);
    expect(swingShift(1, 0.5)).toBe(0);
    expect(swingShift(0.25, 0.5)).toBeCloseTo(0.5 / 12);
    expect(swingShift(0.5, 0.5)).toBeGreaterThan(0);
    expect(swingShift(0.5, 0.5)).toBeLessThan(swingShift(0.25, 0.5));
    expect(swingShift(0.3, 0.5)).toBe(0); // already off the grid
  });

  it('bass and arp swing fully, lead half, pads not at all; input is not mutated', () => {
    const events: MusicEvent[] = [n('bass', 4.25), n('arp', 4.25), n('lead', 4.25), n('pad', 4.25)];
    const out = swingPitchedLayers(events, plan, withKnob(0.5));
    const shift = (i: number): number => (out[i] as NoteEvent).beat - 4.25;
    expect(shift(0)).toBeCloseTo(0.3 / 12);
    expect(shift(1)).toBeCloseTo(0.3 / 12);
    expect(shift(2)).toBeCloseTo(0.15 / 12);
    expect(shift(3)).toBe(0);
    expect((events[0] as NoteEvent).beat).toBe(4.25);
  });
});
