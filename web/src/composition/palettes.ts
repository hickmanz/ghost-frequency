/**

 * Per-song timbre variants: sampled offsets merged under user Sound Lab overrides at playback.

 */

import type { MoodId } from '@shared/index';

import type { TuningOverrides } from '../tuning/schema';

import { stream, type Rng } from './rng';



export interface SongPalette {

  paletteId: string;

  /** dotted tuning keys, plus 'drums.kit' / 'drums.tune' which the renderer splits off for the drum kit */

  overrides: TuningOverrides;

}



/** Ranges [min, max] in native param units for random sampling. Keys must exist in TUNING_SCHEMA / MoodPreset. */

const COMMON: Record<string, readonly [number, number]> = {

  'pad.cutoffMax': [700, 9200],

  'pad.cutoffMin': [120, 1400],

  'arp.cutoffMax': [900, 8500],

  'lead.cutoffMax': [1100, 8800],

  'bass.cutoffMax': [140, 1200],

  'bass.drive': [0, 0.72],

  'arp.chorusWet': [0.05, 0.75],

  'lead.chorusWet': [0.08, 0.7],

  'pad.lfoDepthCents': [0, 650],

  'fx.reverbReturnDb': [-16, -2],

  'fx.delayFeedback': [0.22, 0.58],

  'fx.reverbLpHz': [2500, 14000],

  'fx.delayLpHz': [1200, 9000],

  'drums.ceilingHz': [4500, 15000],

  'drums.hatHpHz': [4000, 10500],

};



const RANGES: Partial<Record<MoodId, Record<string, readonly [number, number]>>> = {

  dreamy: {

    ...COMMON,

    'pad.cutoffMax': [1200, 7200],

    'texture.noiseCutoffMax': [1800, 9000],

    'fx.reverbReturnDb': [-14, -1],

  },

  dark: {

    ...COMMON,

    'pad.cutoffMax': [400, 3200],

    'bass.drive': [0.12, 0.85],

    'fx.reverbLpHz': [1800, 6500],

    'drums.ceilingHz': [3200, 9000],

  },

  nostalgic: {

    ...COMMON,

    'arp.filterOctaves': [0.4, 2.8],

    'lead.vibratoAmount': [0, 0.55],

    'fx.delayFeedback': [0.28, 0.52],

  },

  space: {

    ...COMMON,

    'pad.cutoffMax': [350, 2400],

    'texture.noiseCutoffMax': [800, 11000],

    'texture.droneCutoffMax': [400, 6500],

    'fx.reverbReturnDb': [-10, 2],

    'fx.delayFeedback': [0.35, 0.62],

  },

};



const WAVE_KEYS = ['pad.baseType', 'arp.wave', 'bass.wave', 'lead.wave0'] as const;



function sampleRange(rng: Rng, lo: number, hi: number, spread: number): number {

  const mid = (lo + hi) / 2;

  const half = ((hi - lo) / 2) * spread;

  const v = mid + (rng.next() * 2 - 1) * half;

  return Math.round(v * 1000) / 1000;

}



export function samplePalette(mood: MoodId, rng: Rng, contrast: number): SongPalette {

  const table = RANGES[mood] ?? RANGES.nostalgic!;

  const out: TuningOverrides = {};

  const spread = 0.4 + contrast * 0.6;

  for (const [key, [lo, hi]] of Object.entries(table)) {

    out[key] = sampleRange(rng, lo, hi, spread);

  }

  if (contrast > 0.35 && rng.next() < 0.35 + contrast * 0.4) {

    const key = WAVE_KEYS[Math.floor(rng.next() * WAVE_KEYS.length)]!;

    out[key] = Math.floor(rng.next() * 4);

  }

  const id = `p${Math.floor(rng.next() * 1e6)}`;

  return { paletteId: id, overrides: out };

}



/** Pick a palette id distinct from `avoid` when possible. */

export function paletteDistinct(

  mood: MoodId,

  seed: number,

  songIndex: number,

  contrast: number,

  avoidId?: string,

): SongPalette {

  let p = samplePalette(mood, stream(seed, 'palette', songIndex), contrast);

  for (let i = 0; i < 5 && avoidId && p.paletteId === avoidId; i++) {

    p = samplePalette(mood, stream(seed, 'palette', songIndex, i + 1), contrast);

  }

  return p;

}


