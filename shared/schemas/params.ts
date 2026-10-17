import type { LayerId, MoodId } from './events';

/** User-facing generation controls. All 0..1 unless noted. */
export interface GenerationParams {
  mood: MoodId;
  energy: number;
  complexity: number;
  /** variation / evolution intensity */
  variation: number;
  /** BPM override; null = automatic per mood/seed */
  tempo: number | null;
  /** integer seed (uint32) */
  seed: number;
}

/** Mixer faders 0..1 (default ~0.7) plus master. */
export type MixerParams = Record<LayerId, number> & { master: number };

export const DEFAULT_PARAMS: GenerationParams = {
  mood: 'nostalgic',
  energy: 0.5,
  complexity: 0.5,
  variation: 0.5,
  tempo: null,
  seed: 1984,
};

export const DEFAULT_MIXER: MixerParams = {
  pad: 0.75,
  arp: 0.55,
  bass: 0.7,
  lead: 0.5,
  drums: 0.5,
  texture: 0.45,
  bell: 0.32,
  master: 0.8,
};

/** Saved preset (stored in localStorage as JSON). */
export interface Preset {
  version: 1;
  name: string;
  params: GenerationParams;
  mixer: MixerParams;
  savedAt: number;
}
