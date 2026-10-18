/** Shared context + small helpers for the layer generators. */
import type { GenerationParams, LayerId, NoteEvent } from '@shared/index';
import type { MotifBank } from '../motifs';
import { MOODS, type MoodConfig } from '../moods';
import { effectiveEnergy, type SectionPlan } from '../plan';
import { resolvedSteer } from '../steer';
import { clamp } from '../theory';

export const BEATS_PER_BAR = 4;

export interface LayerContext {
  seed: number;
  plan: SectionPlan;
  /** previous / next section plans if they exist (next is available from LOCK_BARS before the end) */
  prev?: SectionPlan;
  next?: SectionPlan;
  /** absolute bar range [fromBar, toBar) inside `plan` */
  fromBar: number;
  toBar: number;
  /** live params (energy, complexity, variation, mood are read every call) */
  params: GenerationParams;
  bank: MotifBank;
  /** per-engine memo (cleared on init) for decisions that must stay stable across batches */
  cache: Map<string, unknown>;
  /**
   * Set only by the Developed engine. When absent, every layer renders exactly as Full does.
   * `sourceLoop` is the original chord-loop length in bars (before last-pass expansion).
   */
  develop?: { sourceLoop: number; passCount: number };
}

/** mood config of the *live* mood param (styling follows live changes; harmony follows the plan) */
export const liveMood = (ctx: LayerContext): MoodConfig => MOODS[ctx.params.mood];

export const relBar = (ctx: LayerContext, bar: number): number => bar - ctx.plan.startBar;

/** Effective energy (0..1) at an absolute bar. */
export function energyAt(ctx: LayerContext, bar: number): number {
  const build = resolvedSteer(ctx.params).build;
  return effectiveEnergy(ctx.plan, relBar(ctx, bar), ctx.params.energy, build);
}

export function note(layer: LayerId, beat: number, durBeats: number, midi: number, vel: number): NoteEvent {
  return {
    kind: 'note',
    layer,
    beat,
    durBeats: Math.max(0.05, durBeats),
    midi: clamp(Math.round(midi), 0, 127),
    vel: clamp(vel, 0.02, 1),
  };
}
