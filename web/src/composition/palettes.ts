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

/** Ranges [min, max] in native param units for random sampling. */
const RANGES: Partial<Record<MoodId, Record<string, readonly [number, number]>>> = {
  dreamy: {
    'pad.cutoff': [800, 3200],
    'arp.cutoff': [1200, 4800],
    'lead.cutoff': [1500, 5500],
    'bass.cutoff': [200, 900],
    'fx.reverb': [0.45, 0.75],
    'fx.delay': [0.35, 0.65],
  },
  dark: {
    'pad.cutoff': [400, 1800],
    'arp.cutoff': [800, 2800],
    'lead.cutoff': [900, 3200],
    'bass.cutoff': [120, 500],
    'fx.reverb': [0.5, 0.82],
    'fx.delay': [0.25, 0.5],
  },
  nostalgic: {
    'pad.cutoff': [600, 2400],
    'arp.cutoff': [1000, 4000],
    'lead.cutoff': [1200, 4500],
    'fx.reverb': [0.4, 0.62],
    'fx.delay': [0.45, 0.72],
  },
  space: {
    'pad.cutoff': [300, 1400],
    'texture.noise': [0.2, 0.55],
    'fx.reverb': [0.65, 0.92],
    'fx.delay': [0.5, 0.78],
    'lead.cutoff': [1800, 6500],
  },
};

export function samplePalette(mood: MoodId, rng: Rng, contrast: number): SongPalette {
  const table = RANGES[mood] ?? RANGES.nostalgic!;
  const out: TuningOverrides = {};
  const spread = 0.35 + contrast * 0.65;
  for (const [key, [lo, hi]] of Object.entries(table)) {
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * spread;
    const v = mid + (rng.next() * 2 - 1) * half;
    out[key] = Math.round(v * 1000) / 1000;
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
