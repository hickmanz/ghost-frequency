import type { ChordSpec, KeySpec, LayerId, MoodId } from './events';

/** Neural engine steering (0..1). Ignored by pure JS composers. */
export interface VibeParams {
  brightness: number;
  tension: number;
  density: number;
  groove: number;
}

export const DEFAULT_VIBE: VibeParams = {
  brightness: 0.5,
  tension: 0.5,
  density: 0.5,
  groove: 0.5,
};

/** Fine-grained composition steering (0..1). */
export interface SteerParams {
  pace: number;
  build: number;
  motion: number;
  colour: number;
  swing: number;
  busy: number;
  sync: number;
  /** 0 = half-time, 0.5 = normal, 1 = double-time feel */
  feel: number;
  lead: number;
  recall: number;
  register: number;
}

export const DEFAULT_STEER: SteerParams = {
  pace: 0.5,
  build: 0.5,
  motion: 0.5,
  colour: 0.5,
  swing: 0.5,
  busy: 0.5,
  sync: 0.5,
  feel: 0.5,
  lead: 0.5,
  recall: 0.5,
  register: 0.5,
};

/** Renderer-side tone macros (0..1). */
export interface ToneParams {
  bright: number;
  grit: number;
  space: number;
  wow: number;
  crush: number;
}

export const DEFAULT_TONE: ToneParams = {
  bright: 0.55,
  grit: 0.25,
  space: 0.5,
  wow: 0.2,
  crush: 0.1,
};

/** Chaos director (Lorenz LFO groups). */
export interface ChaosParams {
  amount: number;
  rate: number;
  form: boolean;
  harmony: boolean;
  rhythm: boolean;
  melody: boolean;
  tone: boolean;
  /** Occasionally drift mood between songs when enabled. */
  stationDrift: boolean;
}

export const DEFAULT_CHAOS: ChaosParams = {
  amount: 0.35,
  rate: 0.4,
  form: true,
  harmony: true,
  rhythm: true,
  melody: true,
  tone: true,
  stationDrift: false,
};

/** @deprecated UI no longer has Lab/Radio split; kept for old preset JSON. */
export type AppMode = 'lab' | 'radio';

export type SteerPinKey = keyof SteerParams | keyof ToneParams | keyof Pick<GenerationParams, 'energy' | 'complexity' | 'variation' | 'contrast'>;

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
  /** Optional vibe steering for Python neural engines. */
  vibe?: VibeParams;
  /** 0..1: how far consecutive songs diverge (tempo, key, palette). */
  contrast?: number;
  /** Optional fine steering (browser composer). */
  steer?: SteerParams;
}

/** Per-bar harmonic/arrangement context sent to py-neural-layers. */
export interface BarContext {
  bar: number;
  sectionName: string;
  sectionIndex: number;
  key: KeySpec;
  chord: ChordSpec;
  energy: number;
  activeLayers: LayerId[];
  padVoicing: number[];
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
  vibe: { ...DEFAULT_VIBE },
  contrast: 0.5,
  steer: { ...DEFAULT_STEER },
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
  version: 1 | 2;
  name: string;
  params: GenerationParams;
  mixer: MixerParams;
  tone?: ToneParams;
  chaos?: ChaosParams;
  pins?: Partial<Record<string, boolean>>;
  mode?: AppMode;
  tuning?: Partial<Record<MoodId, Record<string, number>>>;
  savedAt: number;
}
