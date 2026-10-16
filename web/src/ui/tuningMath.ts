/**
 * Pure helpers for the Sound Lab sliders (no DOM / React / Tone).
 *
 * Every tuning slider works in an integer "position" domain 0..sliderSteps(param) with step 1, so
 * keyboard arrows move one notch for both linear and log params. Positions map to values through a
 * normalized 0..1 coordinate: linear = lerp, log = exp-interpolation (min * (max/min)^t).
 */
import type { TuningParam } from '../tuning/schema';

export type ParamRange = Pick<TuningParam, 'min' | 'max' | 'step' | 'scale'>;
export type ParamFormat = Pick<TuningParam, 'step' | 'unit'>;

/** Number of slider notches for log-scaled params. */
export const LOG_STEPS = 200;
/** Upper bound on notches for linear params (very fine steps are folded into fewer notches). */
export const MAX_LINEAR_STEPS = 1000;

export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** True when the log mapping is usable (needs 0 < min < max). */
export function isLog(p: ParamRange): boolean {
  return p.scale === 'log' && p.min > 0 && p.max > p.min;
}

/** Normalized 0..1 coordinate -> value (unrounded). */
export function normToValue(p: ParamRange, t: number): number {
  const u = clampNum(Number.isFinite(t) ? t : 0, 0, 1);
  if (p.max <= p.min) return p.min;
  if (isLog(p)) return Math.exp(Math.log(p.min) + u * (Math.log(p.max) - Math.log(p.min)));
  return p.min + u * (p.max - p.min);
}

/** Value -> normalized 0..1 coordinate (clamps out-of-range values). */
export function valueToNorm(p: ParamRange, v: number): number {
  if (p.max <= p.min || !Number.isFinite(v)) return 0;
  const c = clampNum(v, p.min, p.max);
  if (isLog(p)) return (Math.log(c) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min));
  return (c - p.min) / (p.max - p.min);
}

/** Highest slider position (positions are integers 0..sliderSteps). */
export function sliderSteps(p: ParamRange): number {
  if (isLog(p)) return LOG_STEPS;
  if (!(p.step > 0)) return MAX_LINEAR_STEPS;
  return clampNum(Math.round((p.max - p.min) / p.step), 1, MAX_LINEAR_STEPS);
}

/** Number of decimals needed to display multiples of `step` (0..6). */
export function decimalsForStep(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 2;
  const s = step.toString();
  const e = s.indexOf('e-');
  if (e >= 0) return Math.min(6, Number(s.slice(e + 2)) + (s.slice(0, e).split('.')[1]?.length ?? 0));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(6, s.length - dot - 1);
}

/** Snap to the param's step grid (anchored at min) and clamp into [min, max]. */
export function roundToStep(p: ParamRange, v: number): number {
  const c = clampNum(Number.isFinite(v) ? v : p.min, p.min, p.max);
  if (!(p.step > 0)) return c;
  const snapped = p.min + Math.round((c - p.min) / p.step) * p.step;
  const fixed = Number(snapped.toFixed(Math.max(decimalsForStep(p.step), decimalsForStep(p.min))));
  return clampNum(fixed, p.min, p.max);
}

/** Slider position (integer) -> param value, step-rounded and clamped. */
export function sliderToValue(p: ParamRange, pos: number): number {
  const steps = sliderSteps(p);
  return roundToStep(p, normToValue(p, pos / steps));
}

/** Param value -> slider position (integer 0..sliderSteps). */
export function valueToSlider(p: ParamRange, v: number): number {
  const steps = sliderSteps(p);
  return clampNum(Math.round(valueToNorm(p, v) * steps), 0, steps);
}

/** Half a step: values closer than this to the default count as "unchanged". */
function tolerance(p: ParamRange): number {
  return p.step > 0 ? p.step / 2 : 1e-9;
}

/**
 * True when `override` differs meaningfully from the default. No override -> false.
 * An override with an unknown default (undefined) counts as modified.
 */
export function isModified(p: ParamRange, override: number | undefined, def: number | undefined): boolean {
  if (override === undefined || !Number.isFinite(override)) return false;
  if (def === undefined) return true;
  return Math.abs(override - def) > tolerance(p);
}

/** Value to store for a slider result: `undefined` (= no override) when it lands on the default. */
export function valueToOverride(p: ParamRange, value: number, def: number | undefined): number | undefined {
  return isModified(p, value, def) ? value : undefined;
}

/** The value a slider should show: override ?? default ?? min. */
export function resolveValue(p: ParamRange, override: number | undefined, def: number | undefined): number {
  const v = override ?? def ?? p.min;
  return Number.isFinite(v) ? v : p.min;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Human readable value with unit, e.g. "1200 Hz" -> "1.2 kHz", "0.35", "40%". */
export function formatValue(p: ParamFormat, v: number): string {
  if (!Number.isFinite(v)) return '-';
  const dec = decimalsForStep(p.step);
  const unit = p.unit;
  if (unit === 'Hz' && Math.abs(v) >= 1000) return `${trimZeros((v / 1000).toFixed(2))} kHz`;
  const num = v.toFixed(dec);
  if (!unit) return num;
  return unit === '%' || unit === '\u00d7' || unit === '\u00b0' ? `${num}${unit}` : `${num} ${unit}`;
}
