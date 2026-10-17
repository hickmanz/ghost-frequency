/**
 * Per-mood parameter sets for every instrument + fx. Pure data (no Tone imports) so it can be inspected/tested.
 *
 * Conventions
 *  - cutoffMin/cutoffMax (Hz): range the normalized `filter.<layer>` automation (0..1) is log-mapped onto.
 *  - filterDefault (0..1): position inside that range used until automation arrives.
 *  - levelDb: static output trim of the instrument (before channel strip).
 *  - All cutoffs >= 80 Hz, all Q < 8, delay feedback < 0.6.
 */
import type { LayerId, MoodId } from '@shared/index';
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

export interface DrumPreset {
  kickHz: number;
  kickPitchOct: number;
  kickPitchDecay: number;
  kickDecay: number;
  kickDb: number;
  snareBodyHz: number;
  snareNoiseDecay: number;
  snareDb: number;
  /** gated-reverb-ish tail */
  snareTailDb: number;
  snareTailGate: number;
  clapDb: number;
  hatDb: number;
  hatDecay: number;
  hatHpHz: number;
  openHatDb: number;
  openHatDecay: number;
  tomDb: number;
  crashDb: number;
  /** low-pass on drum bus */
  ceilingHz: number;
  levelDb: number;
}

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
    kickHz: 50, kickPitchOct: 2.0, kickPitchDecay: 0.04, kickDecay: 0.36, kickDb: -7,
    snareBodyHz: 185, snareNoiseDecay: 0.17, snareDb: -15, snareTailDb: -28, snareTailGate: 0.18,
    clapDb: -17, hatDb: -26, hatDecay: 0.055, hatHpHz: 5800, openHatDb: -28, openHatDecay: 0.32,
    tomDb: -13, crashDb: -28, ceilingHz: 8500, levelDb: 5,
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
    reverbSend: { pad: 0.55, arp: 0.5, bass: 0.05, lead: 0.52, drums: 0.28, texture: 0.5, bell: 0.62 },
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
    kickHz: 46, kickPitchOct: 2.3, kickPitchDecay: 0.045, kickDecay: 0.4, kickDb: -5,
    snareBodyHz: 165, snareNoiseDecay: 0.18, snareDb: -14, snareTailDb: -30, snareTailGate: 0.16,
    clapDb: -18, hatDb: -28, hatDecay: 0.058, hatHpHz: 5200, openHatDb: -30, openHatDecay: 0.32,
    tomDb: -12, crashDb: -30, ceilingHz: 6200, levelDb: 5,
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
    reverbSend: { pad: 0.4, arp: 0.3, bass: 0.03, lead: 0.4, drums: 0.24, texture: 0.4, bell: 0.5 },
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
    kickHz: 52, kickPitchOct: 2.0, kickPitchDecay: 0.038, kickDecay: 0.32, kickDb: -6,
    snareBodyHz: 195, snareNoiseDecay: 0.17, snareDb: -14, snareTailDb: -22, snareTailGate: 0.2,
    clapDb: -16, hatDb: -24, hatDecay: 0.055, hatHpHz: 6000, openHatDb: -26, openHatDecay: 0.32,
    tomDb: -12, crashDb: -27, ceilingHz: 9000, levelDb: 5,
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
    reverbSend: { pad: 0.35, arp: 0.3, bass: 0.03, lead: 0.38, drums: 0.32, texture: 0.3, bell: 0.48 },
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
    kickHz: 48, kickPitchOct: 1.7, kickPitchDecay: 0.045, kickDecay: 0.38, kickDb: -11,
    snareBodyHz: 175, snareNoiseDecay: 0.16, snareDb: -19, snareTailDb: -30, snareTailGate: 0.15,
    clapDb: -21, hatDb: -32, hatDecay: 0.048, hatHpHz: 5500, openHatDb: -34, openHatDecay: 0.32,
    tomDb: -17, crashDb: -32, ceilingHz: 7200, levelDb: 4,
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
    reverbSend: { pad: 0.8, arp: 0.6, bass: 0.07, lead: 0.58, drums: 0.22, texture: 0.7, bell: 0.7 },
    delaySend: { pad: 0.2, arp: 0.5, bass: 0, lead: 0.48, drums: 0.03, texture: 0.3, bell: 0.4 },
  },
};

/** Immutable built-in defaults. Never mutated (not even by the tuning overrides below). */
export const PRESETS: Record<MoodId, MoodPreset> = { dreamy, dark, nostalgic, space };

// ---------------------------------------------------------------------------------------------
// Sound Lab: live tuning overrides (module-level store, merged on top of the immutable PRESETS)
// ---------------------------------------------------------------------------------------------

type Overrides = Record<string, number>;

const overrideStore: Partial<Record<MoodId, Overrides>> = {};
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
  const ov = overrideStore[m];
  if (!ov) return PRESETS[m];
  let merged = mergedCache[m];
  if (!merged) {
    merged = buildMerged(m, ov);
    mergedCache[m] = merged;
  }
  return merged;
}

/** Mood crossfade time (s) for setMood(). */
export const MOOD_RAMP_SECONDS = 3.0;
