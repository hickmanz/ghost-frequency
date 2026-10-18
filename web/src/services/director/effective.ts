import type { GenerationParams, SteerParams, ToneParams } from '@shared/index';
import type { AppState } from '../store';
import { DEFAULT_STEER, DEFAULT_TONE } from '@shared/index';
import type { ModKey } from './chaos';
import { applyMod } from './chaos';

export type ModOffsets = Partial<Record<ModKey, number>>;

export function effectiveParams(params: GenerationParams, mod: ModOffsets, pins: ReadonlySet<string>): GenerationParams {
  const out = { ...params };
  for (const k of ['energy', 'complexity', 'variation', 'contrast'] as const) {
    if (pins.has(k)) continue;
    const off = mod[k];
    if (off) (out as Record<string, number>)[k] = applyMod(out[k], off);
  }
  const steer: SteerParams = { ...DEFAULT_STEER, ...params.steer };
  for (const k of Object.keys(steer) as (keyof SteerParams)[]) {
    if (pins.has(k)) continue;
    const off = mod[k];
    if (off) steer[k] = applyMod(steer[k], off);
  }
  out.steer = steer;
  return out;
}

export function effectiveTone(tone: ToneParams, mod: ModOffsets, pins: ReadonlySet<string>): ToneParams {
  const out = { ...tone };
  for (const k of Object.keys(out) as (keyof ToneParams)[]) {
    if (pins.has(k)) continue;
    const off = mod[k];
    if (off) out[k] = applyMod(out[k], off);
  }
  return out;
}

export function pinSet(pins: AppState['pins']): ReadonlySet<string> {
  return new Set(Object.keys(pins).filter((k) => pins[k]));
}
