/**
 * Shared swing for the rhythm layers. One amount per song (plan.swing) scaled by the Swing knob, applied to
 * off-grid 16ths (fully) and off-beat 8ths (lightly) so drums, bass and arp push the same notes late together.
 */
import { DEFAULT_STEER, type GenerationParams, type LayerId, type MusicEvent } from '@shared/index';
import type { SectionPlan } from './plan';
import { clamp01 } from './theory';

const BEATS_PER_BAR = 4;
/** At amount 1 an off-16th lands on the triplet position (1/12 beat late). */
const SIXTEENTH_SHIFT = 1 / 12;
const OFF_EIGHTH_SHIFT = 0.04;

/** How much of the full layer amount each pitched layer takes (drums swing inside their own layer). */
const LAYER_WEIGHT: Partial<Record<LayerId, number>> = { bass: 1, arp: 1, lead: 0.5 };

/** Live swing amount for a section: song swing x Swing knob (knob 0 = straight, 0.5 = song default, 1 = double). */
export function swingAmount(plan: SectionPlan, params: GenerationParams): number {
  const knob = clamp01(params.steer?.swing ?? DEFAULT_STEER.swing);
  return Math.min(0.75, (plan.swing ?? 0) * knob * 2);
}

/** Beat offset for a position inside the bar (beats). Positions off the 16th grid are left alone. */
export function swingShift(beatInBar: number, amount: number): number {
  if (amount <= 0) return 0;
  const pos = beatInBar * 4;
  const step = Math.round(pos);
  if (Math.abs(pos - step) > 1e-6) return 0;
  const s = ((step % 16) + 16) % 16;
  if (s % 2 === 1) return amount * SIXTEENTH_SHIFT;
  if (s % 4 === 2) return amount * OFF_EIGHTH_SHIFT;
  return 0;
}

/** Swing the bass / arp / lead notes of a rendered block (returns new note objects; others pass through). */
export function swingPitchedLayers(events: MusicEvent[], plan: SectionPlan, params: GenerationParams): MusicEvent[] {
  const amount = swingAmount(plan, params);
  if (amount <= 0) return events;
  return events.map((e) => {
    if (e.kind !== 'note') return e;
    const w = LAYER_WEIGHT[e.layer];
    if (!w) return e;
    const barStart = Math.floor(e.beat / BEATS_PER_BAR + 1e-9) * BEATS_PER_BAR;
    const shift = swingShift(e.beat - barStart, amount * w);
    return shift === 0 ? e : { ...e, beat: e.beat + shift };
  });
}
