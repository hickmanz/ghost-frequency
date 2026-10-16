/**
 * Loudness compensation for Sound Lab oscillator choices (pure, Tone-free).
 *
 * Switching the wave shape / stacked-oscillator count of an instrument changes its level. The instruments apply a
 * per-voice trim (dB) next to the waveform change so the result is about as loud as the mood's BUILT-IN sound:
 *
 *   trim = level(builtin wave, builtin count) - level(chosen wave, chosen count)       (clamped, see below)
 *
 * so the built-in configuration of every mood always has a trim of exactly 0 dB (current sounds are unchanged).
 *
 *   level(family, wave, count) = WAVE_LEVEL_DB[family][wave] + STACK_LEVEL_DB[family][count - 1]
 *
 * Both tables are MEASURED (headless-browser Tone.Offline renders of the real instruments with their default filter /
 * envelope, RMS over the sustained part of the notes, additive model wave + count fitted per instrument family,
 * reference = sawtooth with the built-in count = 0 dB). Typical results: sine ~ +3 dB, triangle ~ +1.2 dB, square
 * ~ +4.7 dB louder than a sawtooth at the same gain; a single oscillator is ~ 2-4 dB quieter than a 3-stack, a 5-stack
 * is up to ~ 2 dB louder (arp). The model is accurate to about +-1 dB (detuned stacks beat, so it is not exact).
 */
import type { Wave } from './presets';

export type OscFamily = 'arp' | 'pad' | 'drone' | 'lead0' | 'lead1' | 'bass' | 'sub';

/** Level (dB) of each wave relative to a sawtooth, per instrument family (measured, see header). */
export const WAVE_LEVEL_DB: Record<OscFamily, Record<Wave, number>> = {
  arp: { sine: 4.5, triangle: 2.7, sawtooth: 0, square: 5.5 },
  pad: { sine: 3.1, triangle: 1.4, sawtooth: 0, square: 4.8 },
  drone: { sine: 2.9, triangle: 1.2, sawtooth: 0, square: 4.7 },
  lead0: { sine: 2.8, triangle: 1.1, sawtooth: 0, square: 4.8 },
  lead1: { sine: 3.0, triangle: 1.25, sawtooth: 0, square: 4.75 },
  // the bass offers triangle / sawtooth / square (sine is extrapolated, unused); the sub offers sine / triangle
  bass: { sine: 3.0, triangle: 1.25, sawtooth: 0, square: 4.5 },
  sub: { sine: 0, triangle: -1.75, sawtooth: -2.95, square: 1.8 },
};

/**
 * Level (dB) of a stack of n = 1..5 oscillators relative to a stack of 3 (index = n - 1), per family. Plain single
 * oscillator families (lead1, bass, sub) have no stack; the drone keeps its 2 stacked oscillators.
 */
export const STACK_LEVEL_DB: Record<OscFamily, readonly number[]> = {
  arp: [-4.2, -2.15, 0, 0.95, 1.9],
  pad: [-3.3, -1.4, 0, -0.3, 0.3],
  drone: [0, 0, 0, 0, 0],
  lead0: [-2.25, -0.35, 0, -0.3, -0.3],
  lead1: [0, 0, 0, 0, 0],
  bass: [0, 0, 0, 0, 0],
  sub: [0, 0, 0, 0, 0],
};

/** Level (dB, relative to a stack of 3) of `count` stacked oscillators of `family` (count is rounded and clamped to 1..5). */
export function stackLevelDb(family: OscFamily, count: number): number {
  const table = STACK_LEVEL_DB[family];
  const n = Number.isFinite(count) ? Math.min(table.length, Math.max(1, Math.round(count))) : 1;
  return table[n - 1] ?? 0;
}
/** Hard limits of the trim: never boost by more than +4 dB (peak safety), never cut by more than 9 dB. */
export const TRIM_MIN_DB = -9;
export const TRIM_MAX_DB = 4;

/** Level (dB, arbitrary reference) of an oscillator configuration. */
export function oscLevelDb(family: OscFamily, wave: Wave, count: number): number {
  return WAVE_LEVEL_DB[family][wave] + stackLevelDb(family, count);
}

/**
 * Gain trim (dB) to apply to a voice running `wave` x `count` so that it is as loud as the reference configuration
 * (`refWave` x `refCount` = the mood's built-in one). 0 dB when (wave, count) equals the reference.
 */
export function oscTrimDb(family: OscFamily, wave: Wave, count: number, refWave: Wave, refCount: number): number {
  const t = oscLevelDb(family, refWave, refCount) - oscLevelDb(family, wave, count);
  if (!Number.isFinite(t)) return 0;
  return Math.min(TRIM_MAX_DB, Math.max(TRIM_MIN_DB, t));
}
