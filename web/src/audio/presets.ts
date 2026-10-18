/**
 * Per-mood parameter sets for every instrument + fx. Pure data (no Tone imports) so it can be inspected/tested.
 *
 * Conventions
 *  - cutoffMin/cutoffMax (Hz): range the normalized `filter.<layer>` automation (0..1) is log-mapped onto.
 *  - filterDefault (0..1): position inside that range used until automation arrives.
 *  - levelDb: static output trim of the instrument (before channel strip).
 *  - All cutoffs >= 80 Hz, all Q < 8, delay feedback < 0.6.
 */
import type { DrumKitId, LayerId, MoodId } from '@shared/index';
import { TUNING_SCHEMA } from '../tuning/params';
import type { TuningParam } from '../tuning/schema';

/** Oscillator shapes selectable in the Sound Lab. The choice value stored in tuning overrides is the index in WAVES. */
export const WAVES = ['sine', 'triangle', 'sawtooth', 'square'] as const;
export type Wave = (typeof WAVES)[number];
/** Historical name (pad / drone base oscillator). */
export type BaseWave = Wave;

/** Number of stacked (detuned) oscillators per voice: allowed range of the unison sliders. */
export const UNISON_MAX = { arp: 5, lead0: 4, pad: 5 } as const;

export interface PadPreset {
  baseType: BaseWave;
  /** stacked oscillators per voice (1..5, integer; 1 = a single oscillator) */
  unison: number;
  /** total detune spread in cents across the 3 oscillators of each voice */
  spread: number;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  q: number;
  /** filter LFO */
  lfoRate: number;
  lfoDepthCents: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  chorusRate: number;
  chorusDelayMs: number;
  chorusDepth: number;
  chorusWet: number;
  /** 0.5 = unchanged stereo image, > 0.5 wider */
  width: number;
  levelDb: number;
}

export interface ArpPreset {
  /** oscillator shape (default sawtooth: supersaw-style, avoids the thin chiptune pulse sound) */
  wave: Wave;
  /** stacked oscillators per voice (1..5, integer; 1 = a single oscillator) */
  unison: number;
  /** detune spread in cents across the stacked oscillators */
  spread: number;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  q: number;
  /** octaves the filter envelope sweeps above the cutoff */
  filterOctaves: number;
  filterDecay: number;
  attack: number;
  decay: number;
  release: number;
  chorusWet: number;
  panRate: number;
  panDepth: number;
  levelDb: number;
}

export interface BassPreset {
  /** main oscillator shape (sawtooth | square | triangle) */
  wave: Wave;
  /** sub oscillator shape (sine | triangle) */
  subWave: Wave;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  q: number;
  filterOctaves: number;
  filterDecay: number;
  ampDecay: number;
  sustain: number;
  release: number;
  /** portamento seconds */
  glide: number;
  sawDb: number;
  subDb: number;
  /** parallel saturation amount 0..1 on the saw */
  drive: number;
  levelDb: number;
}

export interface LeadPreset {
  /** voice 0 oscillator shape (stacked) */
  wave0: Wave;
  /** voice 0 stacked oscillators (1..4, integer; 1 = a single oscillator) */
  unison0: number;
  /** voice 1 oscillator shape (single oscillator) */
  wave1: Wave;
  sawDb: number;
  /** level of the second (plain saw) voice; named squareDb historically, it is no longer a square wave */
  squareDb: number;
  /** harmonicity of the square voice relative to saw (1.004 ~ +7 cents) */
  harmonicity: number;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  q: number;
  filterOctaves: number;
  filterDecay: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  portamento: number;
  /** DuoSynth vibratoAmount (depth in cents ~= 50 * amount) */
  vibratoAmount: number;
  vibratoRate: number;
  /** seconds after note start before vibrato begins to fade in, and fade length */
  vibratoDelay: number;
  vibratoFade: number;
  chorusWet: number;
  levelDb: number;
}

export type DrumNoise = 'white' | 'pink' | 'brown';

export interface DrumPreset {
  kickHz: number;
  kickPitchOct: number;
  kickPitchDecay: number;
  kickDecay: number;
  kickDb: number;
  /** beater click, dB relative to the kick */
  kickClickDb: number;
  snareBodyHz: number;
  /** tonal body, dB relative to the snare noise */
  snareBodyDb: number;
  snareNoiseDecay: number;
  snareNoise: DrumNoise;
  snareDb: number;
  /** gated-reverb-ish tail */
  snareTailDb: number;
  snareTailGate: number;
  /** low-pass on the gated tail: higher = a brighter "tssh" */
  snareTailHz: number;
  /** bright white-noise "sizzle" on top of the snare (bypasses the bus ceiling) */
  snareSizzleDb: number;
  snareSizzleDecay: number;
  clapDb: number;
  rimDb: number;
  hatDb: number;
  hatDecay: number;
  hatHpHz: number;
  openHatDb: number;
  openHatDecay: number;
  rideDb: number;
  shakerDb: number;
  tomDb: number;
  crashDb: number;
  /** bus saturation amount (1 = clean, ~4 = crunchy) */
  drive: number;
  /** low-pass on drum bus */
  ceilingHz: number;
  levelDb: number;
}

type DrumShapeKey =
  | 'kickHz' | 'kickPitchOct' | 'kickPitchDecay' | 'kickDecay' | 'snareBodyHz' | 'snareNoiseDecay' | 'snareNoise'
  | 'snareTailGate' | 'snareTailHz' | 'snareSizzleDecay' | 'hatDecay' | 'hatHpHz' | 'openHatDecay' | 'drive';
type DrumDbKey =
  | 'kickDb' | 'kickClickDb' | 'snareDb' | 'snareBodyDb' | 'snareTailDb' | 'snareSizzleDb' | 'clapDb' | 'rimDb' | 'hatDb' | 'openHatDb'
  | 'rideDb' | 'shakerDb' | 'tomDb' | 'crashDb' | 'levelDb';

/** A drum machine character: absolute sound shape, dB offsets on the mood levels, and a ceiling multiplier. */
export interface DrumKit {
  shape: Partial<Pick<DrumPreset, DrumShapeKey>>;
  db: Partial<Record<DrumDbKey, number>>;
  ceilingMul?: number;
}

export const DRUM_KITS: Record<DrumKitId, DrumKit> = {
  // LinnDrum: punchy, short kick, bright cracking snare with a gated tail
  linn: {
    shape: {
      kickHz: 55, kickPitchOct: 1.8, kickPitchDecay: 0.03, kickDecay: 0.3, snareBodyHz: 200, snareNoiseDecay: 0.16,
      snareNoise: 'white', snareTailGate: 0.22, snareTailHz: 7500, snareSizzleDecay: 0.12, hatDecay: 0.045,
      hatHpHz: 7000, openHatDecay: 0.28, drive: 1.6,
    },
    db: { snareTailDb: 3, snareSizzleDb: 4, clapDb: 1, kickClickDb: -2 },
    ceilingMul: 1.1,
  },
  // Oberheim DMX: fat, crunchy snare, big gated room
  dmx: {
    shape: {
      kickHz: 52, kickPitchOct: 2.2, kickPitchDecay: 0.04, kickDecay: 0.34, snareBodyHz: 180, snareNoiseDecay: 0.2,
      snareNoise: 'white', snareTailGate: 0.26, snareTailHz: 7000, snareSizzleDecay: 0.14, hatDecay: 0.05,
      hatHpHz: 6500, openHatDecay: 0.32, drive: 2.3,
    },
    db: { snareDb: 1, snareTailDb: 4, snareSizzleDb: 4, snareBodyDb: 1 },
  },
  // TR-808: long boomy sub kick, snappy snare, crisp hats, loud clap
  tr808: {
    shape: {
      kickHz: 45, kickPitchOct: 1.4, kickPitchDecay: 0.06, kickDecay: 0.75, snareBodyHz: 240, snareNoiseDecay: 0.14,
      snareNoise: 'white', snareTailGate: 0.1, snareSizzleDecay: 0.13, hatDecay: 0.04, hatHpHz: 8000,
      openHatDecay: 0.42, drive: 1.5,
    },
    db: { kickDb: 1, snareTailDb: -8, snareSizzleDb: 5, clapDb: 3, kickClickDb: -10, rimDb: 2, snareBodyDb: 2 },
  },
  // TR-909: clicky punchy kick, noisy snare, bright hats and ride
  tr909: {
    shape: {
      kickHz: 56, kickPitchOct: 2.6, kickPitchDecay: 0.035, kickDecay: 0.42, snareBodyHz: 210, snareNoiseDecay: 0.2,
      snareNoise: 'white', snareTailGate: 0.14, snareSizzleDecay: 0.17, hatDecay: 0.05, hatHpHz: 7500,
      openHatDecay: 0.36, drive: 2,
    },
    db: { kickClickDb: 4, snareSizzleDb: 6, hatDb: 2, openHatDb: 2, rideDb: 3 },
    ceilingMul: 1.15,
  },
  // Simmons: pitched, zappy snare and big toms
  simmons: {
    shape: {
      kickHz: 58, kickPitchOct: 2.8, kickPitchDecay: 0.05, kickDecay: 0.38, snareBodyHz: 260, snareNoiseDecay: 0.15,
      snareNoise: 'pink', snareTailGate: 0.18, snareTailHz: 6500, hatDecay: 0.05, hatHpHz: 6800, openHatDecay: 0.3,
      drive: 1.8,
    },
    db: { tomDb: 3, snareTailDb: 2, snareSizzleDb: 1, crashDb: 2, snareBodyDb: 3 },
  },
  // cassette-bounced machine: dark, saturated, soft hats
  tape: {
    shape: {
      kickHz: 48, kickPitchOct: 1.6, kickPitchDecay: 0.045, kickDecay: 0.36, snareBodyHz: 175, snareNoiseDecay: 0.18,
      snareNoise: 'pink', snareTailGate: 0.18, hatDecay: 0.05, hatHpHz: 5000, openHatDecay: 0.3, drive: 3.2,
    },
    db: { hatDb: -2, openHatDb: -2, kickClickDb: -4, snareSizzleDb: -4 },
    ceilingMul: 0.65,
  },
  // soft: rounded, quiet, little click, for dreamy / space songs
  soft: {
    shape: {
      kickHz: 50, kickPitchOct: 1.5, kickPitchDecay: 0.05, kickDecay: 0.32, snareBodyHz: 190, snareNoiseDecay: 0.14,
      snareNoise: 'pink', snareTailGate: 0.12, hatDecay: 0.04, hatHpHz: 6200, openHatDecay: 0.28, drive: 1.1,
    },
    db: { kickDb: -2, snareDb: -3, clapDb: -3, snareTailDb: -6, snareSizzleDb: -5, kickClickDb: -6, levelDb: -1 },
    ceilingMul: 0.9,
  },
};

export interface TexturePreset {
  pinkDb: number;
  brownDb: number;
  noiseCutoffMin: number;
  noiseCutoffMax: number;
  noiseFilterDefault: number;
  noiseLfoRate: number;
  noiseLfoDepthCents: number;
  /** default value (0..1 as in 'texture.noise') until automation arrives */
  noiseDefault: number;
  /** extra linear scale on the noise level mapping */
  noiseScaleDb: number;
  droneBaseType: BaseWave;
  /** detune spread (cents) across the 2 stacked oscillators of each drone */
  droneSpread: number;
  droneCutoffMin: number;
  droneCutoffMax: number;
  droneFilterDefault: number;
  droneQ: number;
  droneLfoRate: number;
  droneLfoDepthCents: number;
  droneAttack: number;
  droneRelease: number;
  droneDb: number;
  levelDb: number;
}

export interface FxPreset {
  /** gain of the reverb return (dB) */
  reverbReturnDb: number;
  reverbLpHz: number;
  reverbHpHz: number;
  /** delay time in beats (0.75 = dotted eighth) */
  delayBeats: number;
  /** per-hop feedback, must stay < 0.6 */
  delayFeedback: number;
  /** low-pass inside the feedback loop: darkens repeats */
  delayLpHz: number;
  delayReturnDb: number;
  /** how much of the delay return also feeds the reverb (linear) */
  delayToReverb: number;
  /** base send levels (linear) per layer */
  reverbSend: Record<LayerId, number>;
  delaySend: Record<LayerId, number>;
}

export interface MoodPreset {
  pad: PadPreset;
  arp: ArpPreset;
  bass: BassPreset;
  lead: LeadPreset;
  drums: DrumPreset;
  texture: TexturePreset;
  fx: FxPreset;
}

/** Reverb IR parameters (the single shared reverb is generated once with these). */
export const REVERB_IR = { decay: 7.0, preDelay: 0.028, brightHz: 8500, darkHz: 1500 } as const;
/** Maximum delay line length (s) */
export const MAX_DELAY_SECONDS = 3;

const dreamy: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 30, cutoffMin: 500, cutoffMax: 8000, filterDefault: 0.6, q: 0.9,
    lfoRate: 0.09, lfoDepthCents: 450, attack: 1.8, decay: 1.5, sustain: 0.85, release: 4.0,
    chorusRate: 0.7, chorusDelayMs: 3.8, chorusDepth: 0.7, chorusWet: 0.65, width: 0.7, levelDb: 1,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 24, cutoffMin: 400, cutoffMax: 4200, filterDefault: 0.5, q: 1.2, filterOctaves: 2.2,
    filterDecay: 0.45, attack: 0.012, decay: 0.5, release: 0.6, chorusWet: 0.7, panRate: 0.18, panDepth: 0.4,
    levelDb: 0,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 120, cutoffMax: 900, filterDefault: 0.5, q: 2.5, filterOctaves: 2.2, filterDecay: 0.25,
    ampDecay: 0.3, sustain: 0.6, release: 0.18, glide: 0.03, sawDb: -4, subDb: -6, drive: 0.12, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -3, squareDb: -9, harmonicity: 1.002, cutoffMin: 600, cutoffMax: 4800, filterDefault: 0.42, q: 1.0,
    filterOctaves: 1.35, filterDecay: 0.55, attack: 0.11, decay: 0.45, sustain: 0.78, release: 1.8, portamento: 0.07,
    vibratoAmount: 0.14, vibratoRate: 4.4, vibratoDelay: 0.85, vibratoFade: 1.9, chorusWet: 0.38, levelDb: -1,
  },
  drums: {
    kickHz: 50, kickPitchOct: 2.0, kickPitchDecay: 0.04, kickDecay: 0.36, kickDb: -7, kickClickDb: -14,
    snareBodyHz: 185, snareBodyDb: -4, snareNoiseDecay: 0.17, snareNoise: 'pink', snareDb: -15, snareTailDb: -28,
    snareTailGate: 0.18, snareTailHz: 4200, snareSizzleDb: -27, snareSizzleDecay: 0.11, clapDb: -17, rimDb: -22, hatDb: -26, hatDecay: 0.055, hatHpHz: 5800, openHatDb: -28,
    openHatDecay: 0.32, rideDb: -30, shakerDb: -29, tomDb: -13, crashDb: -28, drive: 1.4, ceilingHz: 8500, levelDb: 5,
  },
  texture: {
    pinkDb: -3, brownDb: -9, noiseCutoffMin: 300, noiseCutoffMax: 7000, noiseFilterDefault: 0.5,
    noiseLfoRate: 0.05, noiseLfoDepthCents: 500, noiseDefault: 0.35, noiseScaleDb: 0,
    droneBaseType: 'sawtooth', droneSpread: 14, droneCutoffMin: 150, droneCutoffMax: 3000, droneFilterDefault: 0.55,
    droneQ: 1.0, droneLfoRate: 0.035, droneLfoDepthCents: 500, droneAttack: 4.0, droneRelease: 6.0,
    droneDb: 0, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -3, reverbLpHz: 9000, reverbHpHz: 180, delayBeats: 0.75, delayFeedback: 0.42, delayLpHz: 3800,
    delayReturnDb: -3, delayToReverb: 0.35,
    reverbSend: { pad: 0.55, arp: 0.5, bass: 0.05, lead: 0.52, drums: 0.1, texture: 0.5, bell: 0.62 },
    delaySend: { pad: 0.1, arp: 0.5, bass: 0, lead: 0.4, drums: 0.05, texture: 0.1, bell: 0.35 },
  },
};

const dark: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 18, cutoffMin: 200, cutoffMax: 2800, filterDefault: 0.45, q: 1.4,
    lfoRate: 0.04, lfoDepthCents: 500, attack: 2.4, decay: 1.5, sustain: 0.85, release: 5.0,
    chorusRate: 0.4, chorusDelayMs: 4.5, chorusDepth: 0.5, chorusWet: 0.3, width: 0.58, levelDb: -2,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 14, cutoffMin: 250, cutoffMax: 2200, filterDefault: 0.45, q: 1.5, filterOctaves: 1.8,
    filterDecay: 0.3, attack: 0.015, decay: 0.4, release: 0.45, chorusWet: 0.45, panRate: 0.12, panDepth: 0.3,
    levelDb: 0,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 100, cutoffMax: 700, filterDefault: 0.4, q: 3.5, filterOctaves: 2.0, filterDecay: 0.2,
    ampDecay: 0.32, sustain: 0.65, release: 0.2, glide: 0.06, sawDb: -3, subDb: -5, drive: 0.4, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -2, squareDb: -8, harmonicity: 1.002, cutoffMin: 350, cutoffMax: 2800, filterDefault: 0.36, q: 1.4,
    filterOctaves: 1.45, filterDecay: 0.5, attack: 0.12, decay: 0.42, sustain: 0.72, release: 1.4, portamento: 0.04,
    vibratoAmount: 0.1, vibratoRate: 4.2, vibratoDelay: 0.9, vibratoFade: 2.0, chorusWet: 0.28, levelDb: -1,
  },
  drums: {
    kickHz: 46, kickPitchOct: 2.3, kickPitchDecay: 0.045, kickDecay: 0.4, kickDb: -5, kickClickDb: -14,
    snareBodyHz: 165, snareBodyDb: -4, snareNoiseDecay: 0.18, snareNoise: 'pink', snareDb: -14, snareTailDb: -30,
    snareTailGate: 0.16, snareTailHz: 4200, snareSizzleDb: -28, snareSizzleDecay: 0.11, clapDb: -18, rimDb: -22, hatDb: -28, hatDecay: 0.058, hatHpHz: 5200, openHatDb: -30,
    openHatDecay: 0.32, rideDb: -32, shakerDb: -31, tomDb: -12, crashDb: -30, drive: 2, ceilingHz: 6200, levelDb: 5,
  },
  texture: {
    pinkDb: -9, brownDb: -2, noiseCutoffMin: 150, noiseCutoffMax: 2500, noiseFilterDefault: 0.45,
    noiseLfoRate: 0.03, noiseLfoDepthCents: 600, noiseDefault: 0.4, noiseScaleDb: 0,
    droneBaseType: 'sawtooth', droneSpread: 10, droneCutoffMin: 100, droneCutoffMax: 1800, droneFilterDefault: 0.5,
    droneQ: 1.5, droneLfoRate: 0.025, droneLfoDepthCents: 600, droneAttack: 4.0, droneRelease: 6.0,
    droneDb: 0, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -5, reverbLpHz: 4800, reverbHpHz: 160, delayBeats: 1.0, delayFeedback: 0.38, delayLpHz: 2400,
    delayReturnDb: -5, delayToReverb: 0.3,
    reverbSend: { pad: 0.4, arp: 0.3, bass: 0.03, lead: 0.4, drums: 0.08, texture: 0.4, bell: 0.5 },
    delaySend: { pad: 0.05, arp: 0.3, bass: 0, lead: 0.3, drums: 0.04, texture: 0.05, bell: 0.28 },
  },
};

const nostalgic: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 24, cutoffMin: 350, cutoffMax: 4200, filterDefault: 0.55, q: 1.0,
    lfoRate: 0.06, lfoDepthCents: 300, attack: 1.2, decay: 1.2, sustain: 0.88, release: 3.0,
    chorusRate: 0.5, chorusDelayMs: 3.5, chorusDepth: 0.6, chorusWet: 0.5, width: 0.65, levelDb: 0,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 20, cutoffMin: 300, cutoffMax: 3200, filterDefault: 0.5, q: 1.3, filterOctaves: 2.0,
    filterDecay: 0.36, attack: 0.012, decay: 0.45, release: 0.5, chorusWet: 0.6, panRate: 0.2, panDepth: 0.35,
    levelDb: 0,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 150, cutoffMax: 1200, filterDefault: 0.5, q: 3.0, filterOctaves: 2.6, filterDecay: 0.22,
    ampDecay: 0.28, sustain: 0.6, release: 0.16, glide: 0.04, sawDb: -3.5, subDb: -7, drive: 0.2, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -3, squareDb: -9, harmonicity: 1.002, cutoffMin: 500, cutoffMax: 4000, filterDefault: 0.48, q: 1.15,
    filterOctaves: 1.4, filterDecay: 0.48, attack: 0.1, decay: 0.38, sustain: 0.76, release: 1.5, portamento: 0.05,
    vibratoAmount: 0.12, vibratoRate: 4.5, vibratoDelay: 0.85, vibratoFade: 1.8, chorusWet: 0.34, levelDb: -1,
  },
  drums: {
    kickHz: 52, kickPitchOct: 2.0, kickPitchDecay: 0.038, kickDecay: 0.32, kickDb: -6, kickClickDb: -14,
    snareBodyHz: 195, snareBodyDb: -4, snareNoiseDecay: 0.17, snareNoise: 'pink', snareDb: -14, snareTailDb: -22,
    snareTailGate: 0.2, snareTailHz: 4200, snareSizzleDb: -25, snareSizzleDecay: 0.11, clapDb: -16, rimDb: -20, hatDb: -24, hatDecay: 0.055, hatHpHz: 6000, openHatDb: -26,
    openHatDecay: 0.32, rideDb: -28, shakerDb: -27, tomDb: -12, crashDb: -27, drive: 1.6, ceilingHz: 9000, levelDb: 5,
  },
  texture: {
    pinkDb: -4, brownDb: -10, noiseCutoffMin: 600, noiseCutoffMax: 8000, noiseFilterDefault: 0.5,
    noiseLfoRate: 0.04, noiseLfoDepthCents: 400, noiseDefault: 0.3, noiseScaleDb: -2,
    droneBaseType: 'sawtooth', droneSpread: 12, droneCutoffMin: 150, droneCutoffMax: 2800, droneFilterDefault: 0.5,
    droneQ: 1.0, droneLfoRate: 0.04, droneLfoDepthCents: 450, droneAttack: 3.5, droneRelease: 5.0,
    droneDb: 0, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -5, reverbLpHz: 7000, reverbHpHz: 200, delayBeats: 0.75, delayFeedback: 0.4, delayLpHz: 3200,
    delayReturnDb: -3, delayToReverb: 0.3,
    reverbSend: { pad: 0.35, arp: 0.3, bass: 0.03, lead: 0.38, drums: 0.1, texture: 0.3, bell: 0.48 },
    delaySend: { pad: 0.08, arp: 0.45, bass: 0, lead: 0.36, drums: 0.05, texture: 0.05, bell: 0.3 },
  },
};

const space: MoodPreset = {
  pad: {
    baseType: 'triangle', unison: 3, spread: 32, cutoffMin: 250, cutoffMax: 3500, filterDefault: 0.5, q: 0.9,
    lfoRate: 0.035, lfoDepthCents: 600, attack: 2.5, decay: 2.0, sustain: 0.9, release: 5.5,
    chorusRate: 0.3, chorusDelayMs: 4.0, chorusDepth: 0.75, chorusWet: 0.5, width: 0.75, levelDb: 2,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 26, cutoffMin: 300, cutoffMax: 3500, filterDefault: 0.5, q: 1.2, filterOctaves: 2.0,
    filterDecay: 0.5, attack: 0.02, decay: 0.7, release: 1.0, chorusWet: 0.65, panRate: 0.1, panDepth: 0.5,
    levelDb: -1,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 90, cutoffMax: 500, filterDefault: 0.5, q: 1.5, filterOctaves: 1.2, filterDecay: 0.35,
    ampDecay: 0.45, sustain: 0.7, release: 0.35, glide: 0.08, sawDb: -5, subDb: -4, drive: 0.05, levelDb: -1,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -4, squareDb: -10, harmonicity: 1.002, cutoffMin: 450, cutoffMax: 3800, filterDefault: 0.44, q: 0.85,
    filterOctaves: 1.2, filterDecay: 0.75, attack: 0.22, decay: 0.62, sustain: 0.82, release: 2.6, portamento: 0.1,
    vibratoAmount: 0.16, vibratoRate: 4.0, vibratoDelay: 1.0, vibratoFade: 2.2, chorusWet: 0.42, levelDb: -1,
  },
  drums: {
    kickHz: 48, kickPitchOct: 1.7, kickPitchDecay: 0.045, kickDecay: 0.38, kickDb: -11, kickClickDb: -14,
    snareBodyHz: 175, snareBodyDb: -4, snareNoiseDecay: 0.16, snareNoise: 'pink', snareDb: -19, snareTailDb: -30,
    snareTailGate: 0.15, snareTailHz: 4200, snareSizzleDb: -31, snareSizzleDecay: 0.1, clapDb: -21, rimDb: -26, hatDb: -32, hatDecay: 0.048, hatHpHz: 5500, openHatDb: -34,
    openHatDecay: 0.32, rideDb: -34, shakerDb: -33, tomDb: -17, crashDb: -32, drive: 1.2, ceilingHz: 7200, levelDb: 4,
  },
  texture: {
    pinkDb: -6, brownDb: -5, noiseCutoffMin: 200, noiseCutoffMax: 5000, noiseFilterDefault: 0.5,
    noiseLfoRate: 0.02, noiseLfoDepthCents: 700, noiseDefault: 0.45, noiseScaleDb: 0,
    droneBaseType: 'triangle', droneSpread: 18, droneCutoffMin: 120, droneCutoffMax: 3500, droneFilterDefault: 0.6,
    droneQ: 1.2, droneLfoRate: 0.02, droneLfoDepthCents: 700, droneAttack: 5.0, droneRelease: 8.0,
    droneDb: 2, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -1, reverbLpHz: 8000, reverbHpHz: 150, delayBeats: 1.5, delayFeedback: 0.45, delayLpHz: 3000,
    delayReturnDb: -3, delayToReverb: 0.5,
    reverbSend: { pad: 0.8, arp: 0.6, bass: 0.07, lead: 0.58, drums: 0.08, texture: 0.7, bell: 0.7 },
    delaySend: { pad: 0.2, arp: 0.5, bass: 0, lead: 0.48, drums: 0.03, texture: 0.3, bell: 0.4 },
  },
};

// bright, open, major-key uplift: clean bass, shiny arps, crisp kit, short airy room
const sunrise: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 22, cutoffMin: 500, cutoffMax: 7500, filterDefault: 0.62, q: 0.9,
    lfoRate: 0.07, lfoDepthCents: 250, attack: 1.0, decay: 1.2, sustain: 0.88, release: 2.8,
    chorusRate: 0.6, chorusDelayMs: 3.5, chorusDepth: 0.6, chorusWet: 0.5, width: 0.7, levelDb: 0,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 20, cutoffMin: 450, cutoffMax: 5200, filterDefault: 0.56, q: 1.2, filterOctaves: 2.2,
    filterDecay: 0.32, attack: 0.008, decay: 0.38, release: 0.45, chorusWet: 0.55, panRate: 0.22, panDepth: 0.35,
    levelDb: 0,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 160, cutoffMax: 1300, filterDefault: 0.52, q: 2.6, filterOctaves: 2.4, filterDecay: 0.2,
    ampDecay: 0.26, sustain: 0.6, release: 0.15, glide: 0.03, sawDb: -3.5, subDb: -7, drive: 0.12, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -3, squareDb: -9, harmonicity: 1.002, cutoffMin: 650, cutoffMax: 5200, filterDefault: 0.52, q: 1.1,
    filterOctaves: 1.4, filterDecay: 0.45, attack: 0.07, decay: 0.36, sustain: 0.78, release: 1.3, portamento: 0.05,
    vibratoAmount: 0.12, vibratoRate: 4.8, vibratoDelay: 0.75, vibratoFade: 1.6, chorusWet: 0.32, levelDb: -1,
  },
  drums: {
    kickHz: 54, kickPitchOct: 2.1, kickPitchDecay: 0.036, kickDecay: 0.3, kickDb: -6, kickClickDb: -12,
    snareBodyHz: 200, snareBodyDb: -4, snareNoiseDecay: 0.17, snareNoise: 'white', snareDb: -14, snareTailDb: -22,
    snareTailGate: 0.2, snareTailHz: 5200, snareSizzleDb: -24, snareSizzleDecay: 0.12, clapDb: -15, rimDb: -20, hatDb: -23, hatDecay: 0.05, hatHpHz: 6500, openHatDb: -25,
    openHatDecay: 0.3, rideDb: -27, shakerDb: -26, tomDb: -12, crashDb: -26, drive: 1.5, ceilingHz: 11000, levelDb: 5,
  },
  texture: {
    pinkDb: -6, brownDb: -12, noiseCutoffMin: 700, noiseCutoffMax: 9000, noiseFilterDefault: 0.5,
    noiseLfoRate: 0.05, noiseLfoDepthCents: 400, noiseDefault: 0.25, noiseScaleDb: -3,
    droneBaseType: 'sawtooth', droneSpread: 12, droneCutoffMin: 180, droneCutoffMax: 3200, droneFilterDefault: 0.5,
    droneQ: 1.0, droneLfoRate: 0.04, droneLfoDepthCents: 400, droneAttack: 3.0, droneRelease: 4.5,
    droneDb: -2, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -5, reverbLpHz: 9500, reverbHpHz: 220, delayBeats: 0.75, delayFeedback: 0.36, delayLpHz: 4200,
    delayReturnDb: -4, delayToReverb: 0.28,
    reverbSend: { pad: 0.38, arp: 0.32, bass: 0.03, lead: 0.36, drums: 0.1, texture: 0.3, bell: 0.48 },
    delaySend: { pad: 0.06, arp: 0.42, bass: 0, lead: 0.34, drums: 0.04, texture: 0.05, bell: 0.3 },
  },
};

// outrun: punchy busy bass with some grit, bright plucky arps, loud 909-ish kit, tighter room
const drive: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 20, cutoffMin: 350, cutoffMax: 4800, filterDefault: 0.55, q: 1.1,
    lfoRate: 0.08, lfoDepthCents: 250, attack: 1.0, decay: 1.0, sustain: 0.85, release: 2.2,
    chorusRate: 0.5, chorusDelayMs: 3.5, chorusDepth: 0.55, chorusWet: 0.42, width: 0.66, levelDb: -1,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 18, cutoffMin: 350, cutoffMax: 4600, filterDefault: 0.52, q: 1.6, filterOctaves: 2.6,
    filterDecay: 0.24, attack: 0.006, decay: 0.3, release: 0.32, chorusWet: 0.45, panRate: 0.25, panDepth: 0.3,
    levelDb: 0,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 140, cutoffMax: 1400, filterDefault: 0.5, q: 3.2, filterOctaves: 2.8, filterDecay: 0.16,
    ampDecay: 0.2, sustain: 0.5, release: 0.1, glide: 0.02, sawDb: -3, subDb: -6, drive: 0.32, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -2.5, squareDb: -8, harmonicity: 1.003, cutoffMin: 550, cutoffMax: 4800, filterDefault: 0.5, q: 1.25,
    filterOctaves: 1.5, filterDecay: 0.4, attack: 0.05, decay: 0.34, sustain: 0.76, release: 1.1, portamento: 0.06,
    vibratoAmount: 0.12, vibratoRate: 5.0, vibratoDelay: 0.7, vibratoFade: 1.5, chorusWet: 0.3, levelDb: -1,
  },
  drums: {
    kickHz: 55, kickPitchOct: 2.4, kickPitchDecay: 0.035, kickDecay: 0.34, kickDb: -4, kickClickDb: -10,
    snareBodyHz: 205, snareBodyDb: -3, snareNoiseDecay: 0.18, snareNoise: 'white', snareDb: -13, snareTailDb: -18,
    snareTailGate: 0.24, snareTailHz: 5500, snareSizzleDb: -22, snareSizzleDecay: 0.13, clapDb: -14, rimDb: -20, hatDb: -21, hatDecay: 0.045, hatHpHz: 7000, openHatDb: -23,
    openHatDecay: 0.3, rideDb: -26, shakerDb: -27, tomDb: -11, crashDb: -25, drive: 2.0, ceilingHz: 11500, levelDb: 5.5,
  },
  texture: {
    pinkDb: -7, brownDb: -12, noiseCutoffMin: 600, noiseCutoffMax: 7000, noiseFilterDefault: 0.5,
    noiseLfoRate: 0.06, noiseLfoDepthCents: 400, noiseDefault: 0.25, noiseScaleDb: -3,
    droneBaseType: 'sawtooth', droneSpread: 10, droneCutoffMin: 150, droneCutoffMax: 2600, droneFilterDefault: 0.5,
    droneQ: 1.1, droneLfoRate: 0.05, droneLfoDepthCents: 400, droneAttack: 2.5, droneRelease: 4.0,
    droneDb: -3, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -7, reverbLpHz: 7500, reverbHpHz: 240, delayBeats: 0.75, delayFeedback: 0.34, delayLpHz: 3600,
    delayReturnDb: -5, delayToReverb: 0.25,
    reverbSend: { pad: 0.3, arp: 0.24, bass: 0.02, lead: 0.32, drums: 0.08, texture: 0.25, bell: 0.4 },
    delaySend: { pad: 0.05, arp: 0.38, bass: 0, lead: 0.32, drums: 0.03, texture: 0.04, bell: 0.26 },
  },
};

// darksynth: distorted resonant bass, dark tight pad, hard 808-style kit, short dark room
const chase: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 16, cutoffMin: 220, cutoffMax: 3000, filterDefault: 0.48, q: 1.5,
    lfoRate: 0.06, lfoDepthCents: 400, attack: 1.0, decay: 1.2, sustain: 0.85, release: 2.4,
    chorusRate: 0.4, chorusDelayMs: 4.0, chorusDepth: 0.45, chorusWet: 0.28, width: 0.6, levelDb: -2,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 14, cutoffMin: 280, cutoffMax: 3400, filterDefault: 0.5, q: 2.0, filterOctaves: 2.4,
    filterDecay: 0.22, attack: 0.006, decay: 0.28, release: 0.3, chorusWet: 0.3, panRate: 0.2, panDepth: 0.25,
    levelDb: 0,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 120, cutoffMax: 1100, filterDefault: 0.46, q: 4.0, filterOctaves: 2.6, filterDecay: 0.18,
    ampDecay: 0.22, sustain: 0.55, release: 0.12, glide: 0.03, sawDb: -2.5, subDb: -5, drive: 0.55, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -2, squareDb: -7, harmonicity: 1.004, cutoffMin: 400, cutoffMax: 3600, filterDefault: 0.42, q: 1.6,
    filterOctaves: 1.6, filterDecay: 0.35, attack: 0.04, decay: 0.32, sustain: 0.74, release: 0.9, portamento: 0.04,
    vibratoAmount: 0.08, vibratoRate: 5.2, vibratoDelay: 0.8, vibratoFade: 1.5, chorusWet: 0.22, levelDb: -1,
  },
  drums: {
    kickHz: 47, kickPitchOct: 2.3, kickPitchDecay: 0.045, kickDecay: 0.45, kickDb: -4, kickClickDb: -11,
    snareBodyHz: 180, snareBodyDb: -3, snareNoiseDecay: 0.17, snareNoise: 'white', snareDb: -13, snareTailDb: -24,
    snareTailGate: 0.16, snareTailHz: 4800, snareSizzleDb: -23, snareSizzleDecay: 0.12, clapDb: -14, rimDb: -19, hatDb: -23, hatDecay: 0.045, hatHpHz: 6800, openHatDb: -25,
    openHatDecay: 0.32, rideDb: -28, shakerDb: -28, tomDb: -11, crashDb: -26, drive: 2.6, ceilingHz: 9500, levelDb: 5.5,
  },
  texture: {
    pinkDb: -9, brownDb: -4, noiseCutoffMin: 200, noiseCutoffMax: 3500, noiseFilterDefault: 0.45,
    noiseLfoRate: 0.05, noiseLfoDepthCents: 500, noiseDefault: 0.35, noiseScaleDb: -1,
    droneBaseType: 'sawtooth', droneSpread: 9, droneCutoffMin: 110, droneCutoffMax: 2000, droneFilterDefault: 0.5,
    droneQ: 1.5, droneLfoRate: 0.04, droneLfoDepthCents: 500, droneAttack: 2.5, droneRelease: 4.0,
    droneDb: -1, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -7, reverbLpHz: 5000, reverbHpHz: 200, delayBeats: 0.5, delayFeedback: 0.32, delayLpHz: 2800,
    delayReturnDb: -6, delayToReverb: 0.25,
    reverbSend: { pad: 0.3, arp: 0.22, bass: 0.02, lead: 0.3, drums: 0.07, texture: 0.3, bell: 0.4 },
    delaySend: { pad: 0.04, arp: 0.3, bass: 0, lead: 0.28, drums: 0.03, texture: 0.04, bell: 0.24 },
  },
};

// late-night jazz noir: warm dark tones, breathy slow lead with vibrato, soft taped kit, long dark echoes
const noir: MoodPreset = {
  pad: {
    baseType: 'sawtooth', unison: 3, spread: 20, cutoffMin: 250, cutoffMax: 3000, filterDefault: 0.48, q: 1.1,
    lfoRate: 0.05, lfoDepthCents: 350, attack: 1.6, decay: 1.4, sustain: 0.86, release: 3.8,
    chorusRate: 0.45, chorusDelayMs: 4.0, chorusDepth: 0.6, chorusWet: 0.45, width: 0.66, levelDb: -1,
  },
  arp: {
    wave: 'sawtooth', unison: 3, spread: 16, cutoffMin: 280, cutoffMax: 2600, filterDefault: 0.46, q: 1.2, filterOctaves: 1.8,
    filterDecay: 0.35, attack: 0.012, decay: 0.5, release: 0.6, chorusWet: 0.5, panRate: 0.14, panDepth: 0.4,
    levelDb: -1,
  },
  bass: {
    wave: 'sawtooth', subWave: 'sine', cutoffMin: 100, cutoffMax: 650, filterDefault: 0.44, q: 2.0, filterOctaves: 1.6, filterDecay: 0.3,
    ampDecay: 0.4, sustain: 0.65, release: 0.25, glide: 0.06, sawDb: -5, subDb: -4, drive: 0.15, levelDb: 0,
  },
  lead: {
    wave0: 'sawtooth', unison0: 2, wave1: 'triangle', sawDb: -4, squareDb: -10, harmonicity: 1.002, cutoffMin: 400, cutoffMax: 2600, filterDefault: 0.4, q: 1.0,
    filterOctaves: 1.2, filterDecay: 0.6, attack: 0.16, decay: 0.5, sustain: 0.8, release: 2.0, portamento: 0.09,
    vibratoAmount: 0.22, vibratoRate: 4.6, vibratoDelay: 0.6, vibratoFade: 1.6, chorusWet: 0.3, levelDb: -1,
  },
  drums: {
    kickHz: 48, kickPitchOct: 1.8, kickPitchDecay: 0.045, kickDecay: 0.36, kickDb: -8, kickClickDb: -15,
    snareBodyHz: 175, snareBodyDb: -4, snareNoiseDecay: 0.16, snareNoise: 'pink', snareDb: -16, snareTailDb: -28,
    snareTailGate: 0.16, snareTailHz: 3800, snareSizzleDb: -29, snareSizzleDecay: 0.1, clapDb: -19, rimDb: -18, hatDb: -27, hatDecay: 0.05, hatHpHz: 5600, openHatDb: -29,
    openHatDecay: 0.34, rideDb: -26, shakerDb: -28, tomDb: -14, crashDb: -30, drive: 1.6, ceilingHz: 6800, levelDb: 4.5,
  },
  texture: {
    pinkDb: -4, brownDb: -6, noiseCutoffMin: 300, noiseCutoffMax: 5500, noiseFilterDefault: 0.5,
    noiseLfoRate: 0.06, noiseLfoDepthCents: 600, noiseDefault: 0.45, noiseScaleDb: 0,
    droneBaseType: 'sawtooth', droneSpread: 12, droneCutoffMin: 120, droneCutoffMax: 2000, droneFilterDefault: 0.5,
    droneQ: 1.2, droneLfoRate: 0.03, droneLfoDepthCents: 500, droneAttack: 4.0, droneRelease: 6.0,
    droneDb: -1, levelDb: 6,
  },
  fx: {
    reverbReturnDb: -4, reverbLpHz: 5200, reverbHpHz: 180, delayBeats: 1.0, delayFeedback: 0.46, delayLpHz: 2600,
    delayReturnDb: -3, delayToReverb: 0.4,
    reverbSend: { pad: 0.48, arp: 0.42, bass: 0.04, lead: 0.5, drums: 0.12, texture: 0.45, bell: 0.55 },
    delaySend: { pad: 0.1, arp: 0.4, bass: 0, lead: 0.46, drums: 0.05, texture: 0.1, bell: 0.36 },
  },
};

/** Immutable built-in defaults. Never mutated (not even by the tuning overrides below). */
export const PRESETS: Record<MoodId, MoodPreset> = { dreamy, sunrise, nostalgic, drive, chase, dark, noir, space };

// ---------------------------------------------------------------------------------------------
// Sound Lab: live tuning overrides (module-level store, merged on top of the immutable PRESETS)
// ---------------------------------------------------------------------------------------------

type Overrides = Record<string, number>;

const overrideStore: Partial<Record<MoodId, Overrides>> = {};
/** Per-song palette from composition; merged below user Sound Lab overrides. */
const songPaletteStore: Partial<Record<MoodId, Overrides>> = {};
const mergedCache: Partial<Record<MoodId, MoodPreset>> = {};
let schemaIndex: Map<string, TuningParam> | null = null;
let overrideVersion = 0;

function paramFor(key: string): TuningParam | undefined {
  if (!schemaIndex) {
    schemaIndex = new Map();
    for (const g of TUNING_SCHEMA) for (const prm of g.params) schemaIndex.set(prm.key, prm);
  }
  return schemaIndex.get(key);
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Keys whose slider value must be a whole number (oscillator counts). */
const INTEGER_KEYS: ReadonlySet<string> = new Set(['arp.unison', 'lead.unison0', 'pad.unison']);

/**
 * Walk a dotted path through own properties only. Returns the container + last segment when it ends on a number,
 * or on a string that belongs to a 'choice' schema param (oscillator shapes).
 */
function locate(root: MoodPreset, key: string): { holder: Record<string, unknown>; leaf: string } | null {
  const parts = key.split('.');
  if (parts.length < 2) return null;
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    if (typeof cur !== 'object' || cur === null || !hasOwn(cur, seg)) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  const leaf = parts[parts.length - 1]!;
  if (typeof cur !== 'object' || cur === null || !hasOwn(cur, leaf)) return null;
  const holder = cur as Record<string, unknown>;
  const v = holder[leaf];
  if (typeof v === 'number') return { holder, leaf };
  if (typeof v === 'string' && paramFor(key)?.kind === 'choice') return { holder, leaf };
  return null;
}

/**
 * Choice mapping, single source of truth (pure): the option of `prm` that represents the preset string `s`
 * (option.wave === s), or undefined.
 */
export function choiceValueForString(prm: TuningParam, s: string): number | undefined {
  return prm.options?.find((o) => o.wave === s)?.value;
}

/** Round `v` to the nearest integer and accept it only if it is one of the param's option values. */
export function snapChoice(prm: TuningParam, v: number): number | undefined {
  const r = Math.round(v);
  return prm.options?.some((o) => o.value === r) ? r : undefined;
}

/**
 * The tuning value at a dotted path of the BUILT-IN preset of `mood` (undefined if the key does not resolve).
 * For 'choice' keys whose preset field is a string (oscillator shape) this is the option VALUE (a number).
 */
export function getDefaultValue(mood: MoodId, key: string): number | undefined {
  const base = getBuiltinPreset(mood);
  const loc = locate(base, key);
  if (!loc) return undefined;
  const v = loc.holder[loc.leaf];
  if (typeof v === 'string') {
    const prm = paramFor(key);
    return prm ? choiceValueForString(prm, v) : undefined;
  }
  return v as number;
}

/** The built-in (default) preset of a mood, ignoring any tuning overrides. */
export function getBuiltinPreset(mood: MoodId): MoodPreset {
  return PRESETS[mood] ?? PRESETS.nostalgic;
}

/** Sanitize ONE value for `key` (clamp / round / snap to an option). undefined = drop it. */
function sanitizeValue(key: string, v: number): number | undefined {
  const prm = paramFor(key);
  if (!prm) return v;
  if (prm.kind === 'choice') return snapChoice(prm, v);
  const c = Math.min(prm.max, Math.max(prm.min, v));
  return INTEGER_KEYS.has(key) ? Math.round(c) : c;
}

/**
 * Drop unknown keys and non-finite values, clamp known schema keys to their [min, max]; 'choice' keys are rounded to
 * the nearest integer and kept only if that is a valid option value; integer keys (unison counts) are rounded.
 * Keys that exist in MoodPreset but not in the schema are kept as-is (finite only). Returns a fresh object.
 */
export function sanitizeOverrides(raw: Overrides | null | undefined): Overrides {
  const out: Overrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw)) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!locate(PRESETS.nostalgic, key)) continue;
    const s = sanitizeValue(key, v);
    if (s !== undefined) out[key] = s;
  }
  return out;
}
/** [group, min key, max key] of every cutoff range; max must stay clearly above min (log mapping divides by it). */
const CUTOFF_RANGES: ReadonlyArray<readonly [keyof MoodPreset, string, string]> = [
  ['pad', 'cutoffMin', 'cutoffMax'],
  ['arp', 'cutoffMin', 'cutoffMax'],
  ['bass', 'cutoffMin', 'cutoffMax'],
  ['lead', 'cutoffMin', 'cutoffMax'],
  ['texture', 'noiseCutoffMin', 'noiseCutoffMax'],
  ['texture', 'droneCutoffMin', 'droneCutoffMax'],
];
const MIN_CUTOFF_RATIO = 1.25;

function buildMerged(mood: MoodId, ov: Overrides): MoodPreset {
  const merged = structuredClone(getBuiltinPreset(mood));
  for (const key of Object.keys(ov)) {
    const loc = locate(merged, key);
    if (!loc) continue;
    if (typeof loc.holder[loc.leaf] === 'string') {
      // choice key stored as its option value: map back to the preset string (the ONLY number -> string place)
      const prm = paramFor(key);
      const wave = prm?.options?.find((o) => o.value === ov[key])?.wave;
      if (wave) loc.holder[loc.leaf] = wave;
    } else {
      loc.holder[loc.leaf] = ov[key];
    }
  }
  for (const [group, lo, hi] of CUTOFF_RANGES) {
    const g = merged[group] as unknown as Record<string, number>;
    if (g[hi]! < g[lo]! * MIN_CUTOFF_RATIO) g[hi] = g[lo]! * MIN_CUTOFF_RATIO;
  }
  return merged;
}

/**
 * Replace the tuning overrides of `mood` (dotted keys into MoodPreset, e.g. 'arp.cutoffMax', 'fx.reverbSend.arp').
 * Unknown keys / non-finite values are ignored, known values are clamped to the TUNING_SCHEMA range.
 * Invalidates the merged-preset cache of that mood. An empty object clears the overrides.
 */
export function setTuningOverrides(mood: MoodId, overrides: Overrides): void {
  if (!hasOwn(PRESETS, mood)) return;
  const clean = sanitizeOverrides(overrides);
  if (Object.keys(clean).length === 0) delete overrideStore[mood];
  else overrideStore[mood] = clean;
  delete mergedCache[mood];
  overrideVersion++;
}

/** Composition palette for the active song (user overrides still win). */
export function setSongPalette(mood: MoodId, overrides: Overrides): void {
  if (!hasOwn(PRESETS, mood)) return;
  const clean = sanitizeOverrides(overrides);
  if (Object.keys(clean).length === 0) delete songPaletteStore[mood];
  else songPaletteStore[mood] = clean;
  delete mergedCache[mood];
  overrideVersion++;
}

/** Currently active (sanitized) overrides for a mood. Do not mutate. */
export function getTuningOverrides(mood: MoodId): Readonly<Overrides> {
  return overrideStore[mood] ?? EMPTY_OVERRIDES;
}
const EMPTY_OVERRIDES: Readonly<Overrides> = Object.freeze({});

/** Increments on every setTuningOverrides() call (cheap change detection). */
export function getTuningVersion(): number {
  return overrideVersion;
}

/** Built-in preset deep-merged with the mood's overrides. Cached per mood; the returned object must not be mutated. */
export function getPreset(mood: MoodId): MoodPreset {
  const m: MoodId = hasOwn(PRESETS, mood) ? mood : 'nostalgic';
  const songOv = songPaletteStore[m];
  const userOv = overrideStore[m];
  if (!songOv && !userOv) return PRESETS[m];
  const combined: Overrides = { ...songOv, ...userOv };
  let merged = mergedCache[m];
  if (!merged) {
    merged = buildMerged(m, combined);
    mergedCache[m] = merged;
  }
  return merged;
}

/**
 * Drum preset for a mood with a song kit layered on: mood (incl. song palette) -> kit shape / dB offsets -> the user's
 * Sound Lab drums.* overrides, which always win. `kit` null = the mood's own drums.
 */
export function drumPresetFor(mood: MoodId, kit: DrumKitId | null): DrumPreset {
  const base = getPreset(mood).drums;
  const k = kit ? DRUM_KITS[kit] : undefined;
  if (!k) return base;
  const user = getTuningOverrides(mood);
  const free = (f: string): boolean => !hasOwn(user, `drums.${f}`);
  const out: DrumPreset = { ...base };
  const w = out as unknown as Record<string, number | string>;
  for (const [f, v] of Object.entries(k.shape)) if (free(f) && v !== undefined) w[f] = v;
  for (const [f, d] of Object.entries(k.db)) if (free(f) && d !== undefined) w[f] = (w[f] as number) + d;
  if (k.ceilingMul && free('ceilingHz')) out.ceilingHz = Math.min(18000, base.ceilingHz * k.ceilingMul);
  return out;
}

/** Pull the song kit keys ('drums.kit' index, 'drums.tune' semitones) out of palette overrides. */
export function splitDrumKit(overrides: Readonly<Overrides>): { kit?: number; tune: number; rest: Overrides } {
  const { 'drums.kit': kit, 'drums.tune': tune, ...rest } = overrides;
  return { kit: typeof kit === 'number' ? Math.round(kit) : undefined, tune: typeof tune === 'number' ? tune : 0, rest };
}

/** Mood crossfade time (s) for setMood(). */
export const MOOD_RAMP_SECONDS = 3.0;
