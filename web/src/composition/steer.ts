/**
 * Resolve effective steer values from macros, explicit steer knobs, and vibe (local engine).
 */
import type { GenerationParams, SteerParams, VibeParams } from '@shared/index';
import { DEFAULT_STEER, DEFAULT_VIBE } from '@shared/index';
import { clamp01 } from './theory';

export function resolvedSteer(params: GenerationParams): SteerParams {
  const s = { ...DEFAULT_STEER, ...params.steer };
  const vibe: VibeParams = { ...DEFAULT_VIBE, ...params.vibe };
  const e = params.energy;
  const c = params.complexity;
  const v = params.variation;
  return {
    pace: clamp01(s.pace * 0.55 + e * 0.25 + vibe.groove * 0.2),
    build: clamp01(s.build * 0.5 + e * 0.35 + vibe.tension * 0.15),
    motion: clamp01(s.motion * 0.45 + v * 0.4 + vibe.tension * 0.15),
    colour: clamp01(s.colour * 0.45 + c * 0.4 + vibe.brightness * 0.15),
    swing: clamp01(s.swing * 0.5 + vibe.groove * 0.35),
    busy: clamp01(s.busy * 0.45 + e * 0.35 + vibe.density * 0.2),
    sync: clamp01(s.sync * 0.5 + vibe.groove * 0.3),
    feel: clamp01(s.feel),
    lead: clamp01(s.lead * 0.5 + e * 0.25 + (1 - vibe.density) * 0.25),
    recall: clamp01(s.recall * 0.55 + (1 - v) * 0.25),
    register: clamp01(s.register * 0.5 + vibe.brightness * 0.35),
  };
}

/** How hard the song form pushes forward (0 = long, patient sections; 1 = short intro, early peaks). */
export function formDrive(params: GenerationParams): number {
  return clamp01(params.energy * 0.5 + resolvedSteer(params).pace * 0.5);
}

/** Section length multiplier for a given drive: ~1 at 0.5, longer below, down to 0.5 at full drive. */
export function driveLengthScale(drive: number): number {
  return drive < 0.5 ? 1.25 - drive * 0.5 : 1 - (drive - 0.5);
}

/** Map feel 0..1 to tempo multiplier for pattern density. */
export function feelMul(feel: number): number {
  if (feel < 0.35) return 0.5;
  if (feel > 0.65) return 2;
  return 1;
}

/** Harmony colour knob blended with the complexity macro (voicing density). */
export function layerComplexity(params: GenerationParams): number {
  const s = resolvedSteer(params);
  return clamp01(params.complexity * 0.35 + s.colour * 0.65);
}
