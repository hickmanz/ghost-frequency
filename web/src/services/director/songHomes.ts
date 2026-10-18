/** Seeded per-song macro homes (steer / tone / vibe / energy) — contrast drives spread and edge bias. */

import {

  DEFAULT_STEER,

  DEFAULT_TONE,

  DEFAULT_VIBE,

  type SteerParams,

  type ToneParams,

  type VibeParams,

} from '@shared/index';

import { chance, type Rng } from '../../composition/rng';

import { clamp01 } from '../../composition/theory';



/** 0..1 sample: wider spread and more edge bias as contrast rises (funkier station-to-station). */

export function sampleContrastUnit(rng: Rng, contrast: number): number {

  const c = clamp01(contrast);

  const extreme = 0.18 + c * 0.52;

  if (chance(rng, extreme)) {

    const dark = rng.next() < 0.5;

    if (dark) return clamp01(0.04 + rng.next() * (0.22 + (1 - c) * 0.12));

    return clamp01(0.72 + c * 0.12 + rng.next() * (0.24 - c * 0.08));

  }

  const spread = 0.2 + c * 0.42;

  return clamp01(0.5 + (rng.next() * 2 - 1) * spread);

}



export function blendSongHome(current: number, target: number, contrast: number): number {

  const mix = 0.45 + clamp01(contrast) * 0.55;

  return clamp01(current * (1 - mix) + target * mix);

}



export interface SongHomesSample {

  steer: SteerParams;

  tone: ToneParams;

  vibe: VibeParams;

  energy: number;

  complexity: number;

  variation: number;

}



/** Independent targets for one song index (before blending with live knob positions). */

export function sampleSongHomes(rng: Rng, contrast: number): SongHomesSample {

  const steer = { ...DEFAULT_STEER };

  for (const k of Object.keys(steer) as (keyof SteerParams)[]) {

    steer[k] = sampleContrastUnit(rng, contrast);

  }

  const tone = { ...DEFAULT_TONE };

  for (const k of Object.keys(tone) as (keyof ToneParams)[]) {

    tone[k] = sampleContrastUnit(rng, contrast);

  }

  const vibe: VibeParams = {

    brightness: sampleContrastUnit(rng, contrast),

    tension: sampleContrastUnit(rng, contrast),

    density: sampleContrastUnit(rng, contrast),

    groove: sampleContrastUnit(rng, contrast),

  };

  tone.bright = clamp01(tone.bright * 0.3 + vibe.brightness * 0.7);

  return {

    steer,

    tone,

    vibe,

    energy: sampleContrastUnit(rng, contrast),

    complexity: sampleContrastUnit(rng, contrast),

    variation: sampleContrastUnit(rng, contrast),

  };

}


