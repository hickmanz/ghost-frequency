/**
 * Pure (AudioContext-free, Tone-free) mapping helpers: beat <-> time, normalized automation -> units,
 * gain curves. Everything here is unit-testable in Node.
 */
import type { AutomationTarget, LayerId } from '@shared/index';

// ---------------------------------------------------------------------------------------------
// basics
// ---------------------------------------------------------------------------------------------

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => (Number.isFinite(x) ? clamp(x, 0, 1) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => (g <= 1e-9 ? -180 : 20 * Math.log10(g));

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Exponential (log-frequency) interpolation, v in 0..1. min/max must be > 0. */
export function logMap(v: number, min: number, max: number): number {
  return min * Math.pow(max / min, clamp01(v));
}

/** Inverse of logMap, result clamped to 0..1. */
export function invLogMap(hz: number, min: number, max: number): number {
  return clamp01(Math.log(clamp(hz, min, max) / min) / Math.log(max / min));
}

/** Lowest cutoff we ever program on any filter (Hz). */
export const MIN_CUTOFF_HZ = 80;

/** Clamp a cutoff to [80 Hz, ~0.45 * sampleRate] (and never above 20 kHz). */
export function safeCutoff(hz: number, sampleRate = 44100): number {
  return clamp(hz, MIN_CUTOFF_HZ, Math.min(20000, sampleRate * 0.45));
}

// ---------------------------------------------------------------------------------------------
// tempo / beats
// ---------------------------------------------------------------------------------------------

export const MIN_BPM = 30;
export const MAX_BPM = 240;
export const clampBpm = (bpm: number): number => clamp(Number.isFinite(bpm) ? bpm : 100, MIN_BPM, MAX_BPM);

export const secondsPerBeat = (bpm: number): number => 60 / clampBpm(bpm);
export const beatsToSeconds = (beats: number, bpm: number): number => beats * secondsPerBeat(bpm);
export const secondsToBeats = (seconds: number, bpm: number): number => seconds / secondsPerBeat(bpm);

/**
 * Split a beat position into an integer transport tick (floor) and the remaining sub-tick fraction (0..1).
 * The scheduler schedules at `tick` and adds `fraction * secondsPerTick` to the callback time so notes are
 * not quantised to the tick grid.
 */
export function splitBeatToTick(beat: number, ppq: number): { tick: number; fraction: number } {
  const exact = Math.max(0, beat) * ppq;
  // guard against 191.99999999 style float noise
  const rounded = Math.round(exact);
  const tick = Math.abs(exact - rounded) < 1e-6 ? rounded : Math.floor(exact);
  return { tick, fraction: Math.abs(exact - rounded) < 1e-6 ? 0 : exact - tick };
}

/** Delay time in seconds for a note length expressed in beats (e.g. 0.75 = dotted eighth), clamped. */
export function delaySeconds(bpm: number, beats: number, maxDelay: number): number {
  return clamp(beatsToSeconds(beats, bpm), 0.02, maxDelay);
}

/** Ramp length for an AutomationEvent given its rampBeats and the tempo at that moment. */
export function rampBeatsToSeconds(rampBeats: number | undefined, bpm: number): number {
  if (!rampBeats || rampBeats <= 0 || !Number.isFinite(rampBeats)) return 0;
  return beatsToSeconds(rampBeats, bpm);
}

interface TempoSegment {
  beat: number; // start beat of the segment
  sec: number; // start time of the segment (s)
  bpm0: number; // tempo at segment start
  bpm1: number; // tempo at segment end (== bpm0 for constant)
  durSec: number; // Infinity for the final constant segment
}

/**
 * Piecewise tempo map: constant tempo with optional linear-in-time ramps (this is what a Tone
 * `bpm.rampTo` does). Used for duration estimates (offline rendering) and for tests.
 */
export class TempoMap {
  private segs: TempoSegment[];

  constructor(initialBpm: number) {
    this.segs = [{ beat: 0, sec: 0, bpm0: clampBpm(initialBpm), bpm1: clampBpm(initialBpm), durSec: Infinity }];
  }

  /** Add a tempo change starting at `startBeat` ramping over `rampSeconds` (0 = instant). Must be in order. */
  addChange(startBeat: number, bpm: number, rampSeconds = 0): void {
    const target = clampBpm(bpm);
    const last = this.segs[this.segs.length - 1]!;
    if (startBeat <= last.beat) {
      // replace degenerate/out-of-order segment starts
      if (this.segs.length === 1) {
        this.segs[0] = { ...last, bpm0: target, bpm1: target };
      }
      return;
    }
    const secAtStart = this.beatToSeconds(startBeat);
    const bpmAtStart = this.bpmAtBeat(startBeat);
    // close last segment (it was infinite constant, or an unfinished ramp)
    const prev = this.segs[this.segs.length - 1]!;
    prev.durSec = Math.min(prev.durSec, secAtStart - prev.sec);
    if (rampSeconds > 1e-6) {
      this.segs.push({ beat: startBeat, sec: secAtStart, bpm0: bpmAtStart, bpm1: target, durSec: rampSeconds });
      const endBeat = startBeat + ((bpmAtStart + target) / 2) * (rampSeconds / 60);
      this.segs.push({ beat: endBeat, sec: secAtStart + rampSeconds, bpm0: target, bpm1: target, durSec: Infinity });
    } else {
      this.segs.push({ beat: startBeat, sec: secAtStart, bpm0: target, bpm1: target, durSec: Infinity });
    }
  }

  private segmentForBeat(beat: number): TempoSegment {
    let seg = this.segs[0]!;
    for (const s of this.segs) {
      if (s.beat <= beat) seg = s;
      else break;
    }
    return seg;
  }

  private segmentForSeconds(sec: number): TempoSegment {
    let seg = this.segs[0]!;
    for (const s of this.segs) {
      if (s.sec <= sec) seg = s;
      else break;
    }
    return seg;
  }

  beatToSeconds(beat: number): number {
    const b = Math.max(0, beat);
    const s = this.segmentForBeat(b);
    const db = b - s.beat;
    if (Math.abs(s.bpm1 - s.bpm0) < 1e-9) return s.sec + (db * 60) / s.bpm0;
    // within a ramp: beats(t) = (bpm0*t + 0.5*k*t^2)/60 with k = (bpm1-bpm0)/durSec
    const k = (s.bpm1 - s.bpm0) / s.durSec;
    const beatsTimes60 = db * 60;
    // 0.5*k*t^2 + bpm0*t - beatsTimes60 = 0
    const disc = s.bpm0 * s.bpm0 + 2 * k * beatsTimes60;
    const t = (-s.bpm0 + Math.sqrt(Math.max(0, disc))) / k;
    return s.sec + t;
  }

  secondsToBeat(sec: number): number {
    const t = Math.max(0, sec);
    const s = this.segmentForSeconds(t);
    const dt = t - s.sec;
    if (Math.abs(s.bpm1 - s.bpm0) < 1e-9) return s.beat + (dt * s.bpm0) / 60;
    const k = (s.bpm1 - s.bpm0) / s.durSec;
    return s.beat + (s.bpm0 * dt + 0.5 * k * dt * dt) / 60;
  }

  bpmAtBeat(beat: number): number {
    const s = this.segmentForBeat(Math.max(0, beat));
    if (Math.abs(s.bpm1 - s.bpm0) < 1e-9) return s.bpm0;
    const t = this.beatToSeconds(beat) - s.sec;
    return s.bpm0 + ((s.bpm1 - s.bpm0) / s.durSec) * t;
  }
}

// ---------------------------------------------------------------------------------------------
// gain curves & automation value mapping
// ---------------------------------------------------------------------------------------------

/** User fader 0..1 -> linear gain. Slightly steeper than linear; 0 = silence; 1 = unity. */
export function faderToGain(v: number): number {
  const x = clamp01(v);
  return x <= 0 ? 0 : Math.pow(x, 1.5);
}

/** Section-level automation gain 0..1 (multiplied with fader in a separate gain stage). */
export function layerAutomationGain(v: number): number {
  return clamp01(v);
}

/**
 * send.reverb / send.delay automation 0..1 -> multiplier on the mood's base send level.
 * 0.5 is neutral (x1.0), 0 -> x0.4, 1 -> x1.6. Never fully dry / never absurdly wet.
 */
export function sendMultiplier(v: number): number {
  return 0.4 + 1.2 * clamp01(v);
}
/** Neutral value of send multiplier (no automation received yet). */
export const SEND_NEUTRAL = sendMultiplier(0.5);

/**
 * texture.noise 0..1 -> linear gain of noise bed (before the preset's noise scale).
 * 0 => silent, otherwise -46 dB .. -10 dB (cubic-ish perceptual feel via dB mapping).
 */
export function noiseLevelToGain(v: number): number {
  const x = clamp01(v);
  if (x < 0.002) return 0;
  return dbToGain(-46 + 36 * x);
}

export const MASTER_FILTER_MIN_HZ = 200;
export const MASTER_FILTER_MAX_HZ = 20000;
/** master.filter 0..1 -> cutoff Hz (log, 1 = fully open). */
export function masterFilterHz(v: number, sampleRate = 44100): number {
  const x = clamp01(v);
  const hz = logMap(x, MASTER_FILTER_MIN_HZ, MASTER_FILTER_MAX_HZ);
  return safeCutoff(x >= 0.999 ? MASTER_FILTER_MAX_HZ : hz, sampleRate);
}

/**
 * Tone "Bright" + "Crush" macros -> master.filter 0..1. Bright >= ~0.5 is fully open; only the lower half
 * darkens (bright 0 ~ 3 kHz). Crush trims a little off the top.
 */
export function brightToMasterFilter(bright: number, crush: number): number {
  return clamp01(0.6 + clamp01(bright) * 0.8 - clamp01(crush) * 0.15);
}

/** Soft-clip saturation curve (tanh), unity small-signal gain, `drive` >= 0 (0.5 gentle .. 3 strong). */
/**
 * Parallel drum saturation mix for a kit drive (1 = clean .. ~3.5 = crunchy): the wet (shaped) share and the dry
 * share. Dry never drops below ~0.75, so kick/snare transients stay clean and the crunch is blended in, not forced.
 */
export function drumSaturationMix(drive: number): { wet: number; dry: number } {
  const wet = Math.min(0.45, Math.max(0, (drive - 1) * 0.18));
  return { wet, dry: 1 - wet * 0.55 };
}

export function saturationCurve(drive: number, length = 2048): Float32Array {
  const d = Math.max(0.01, drive);
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * d) / d;
  }
  return curve;
}

// ---------------------------------------------------------------------------------------------
// automation target parsing
// ---------------------------------------------------------------------------------------------

export type ParsedTarget =
  | { kind: 'filter'; layer: LayerId }
  | { kind: 'layerGain'; layer: LayerId }
  | { kind: 'sendReverb' }
  | { kind: 'sendDelay' }
  | { kind: 'textureNoise' }
  | { kind: 'masterFilter' }
  | { kind: 'param'; key: string; layer: LayerId }
  | { kind: 'duck'; layer: LayerId }
  | { kind: 'unknown' };

const LAYERS: readonly string[] = ['pad', 'arp', 'bass', 'lead', 'drums', 'texture', 'bell'];

export function parseTarget(target: AutomationTarget | string): ParsedTarget {
  switch (target) {
    case 'send.reverb':
      return { kind: 'sendReverb' };
    case 'send.delay':
      return { kind: 'sendDelay' };
    case 'texture.noise':
      return { kind: 'textureNoise' };
    case 'master.filter':
      return { kind: 'masterFilter' };
    default:
      break;
  }
  if (target.startsWith('filter.')) {
    const l = target.slice(7);
    if (LAYERS.includes(l)) return { kind: 'filter', layer: l as LayerId };
  } else if (target.startsWith('layer.gain.')) {
    const l = target.slice(11);
    if (LAYERS.includes(l)) return { kind: 'layerGain', layer: l as LayerId };
  } else if (target.startsWith('duck.')) {
    const l = target.slice(5);
    if (l === 'pad' || l === 'texture') return { kind: 'duck', layer: l };
  } else if (target.startsWith('param.')) {
    const key = target.slice(6);
    const l = key.split('.')[0] ?? '';
    if (LAYERS.includes(l)) return { kind: 'param', key, layer: l as LayerId };
  }
  return { kind: 'unknown' };
}
