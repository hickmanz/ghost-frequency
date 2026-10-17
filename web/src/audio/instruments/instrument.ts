import type * as Tone from 'tone';
import type { LayerId, MoodId } from '@shared/index';

/** Parameters an instrument can be automated on (normalized 0..1). */
export type InstrumentParam = 'filter' | 'noise';

/**
 * Common instrument contract. Instruments create all their nodes ONCE (constructor) and reuse them;
 * they never create synths per note and never dispose/rebuild sounding nodes when the mood changes.
 */
export interface Instrument {
  readonly layer: LayerId;
  /** Post-instrument signal (stereo or mono). Connected to the channel strip by the graph. */
  readonly output: Tone.ToneAudioNode;
  /** Play a note. `durSeconds` already converted from beats at the current tempo. `time` is audio-context time. */
  trigger(midi: number, durSeconds: number, time: number, vel: number): void;
  /** Normalized automation (0..1) of an instrument parameter; ramp in seconds (0 = (nearly) immediate). */
  automate(param: InstrumentParam, value01: number, time: number, rampSeconds?: number): void;
  /** Composer / Auteur: dotted preset key (e.g. pad.attack), value 0..1 mapped via Sound Lab ranges. Optional. */
  automateParam?(presetKey: string, value01: number, time: number, rampSeconds?: number): void;
  /** Ramp every tweakable parameter to the mood's preset over `rampSeconds`. Never rebuilds nodes.
   *  `resetAutomation` = forget automated filter/noise positions and go back to the preset defaults. */
  setPreset(mood: MoodId, rampSeconds: number, resetAutomation?: boolean): void;
  /** Release all sounding notes at `time` (default: now). */
  releaseAll(time?: number): void;
  /** Number of voices currently sounding (including release tails). For diagnostics. */
  getActiveVoices(): number;
  dispose(): void;
}

/** Release time (s) used by releaseAll(): quick, click-free silence instead of the preset's long tails. */
export const FAST_RELEASE = 0.06;

/** Structural subset of Tone.Param / Tone.Signal we use for smoothing. */
export interface RampableParam {
  setValueAtTime(value: any, time: number): unknown;
  rampTo(value: any, rampTime: number, startTime?: number): unknown;
}

/** Jump (ramp ~0) or ramp a Tone param to `value` starting at `time`. */
export function rampParam(param: RampableParam, value: number, time: number, rampSeconds = 0): void {
  if (rampSeconds > 0.003) param.rampTo(value, rampSeconds, time);
  else param.setValueAtTime(value, time);
}

/** Integer oscillator count within 1..max (non-finite -> 1). */
export function clampCount(n: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.round(n))) : 1;
}

/**
 * Change the unison count of a (silent) fat oscillator without leaking nodes.
 * Tone v15's `count` setter disposes the inner oscillators but leaves the outer frequency/detune signals connected
 * to them, which keeps ~2 running ConstantSourceNodes alive per disposed oscillator. Detach them first (guarded:
 * if Tone's private layout differs, this degrades to the plain setter). The source is also stopped at `now` beforehand
 * so Tone neither restarts the new oscillators nor warns about an untimed stop() inside a scheduled callback.
 */
export function setFatCount(osc: Tone.OmniOscillator<any>, count: number, spread: number, now: number): void {
  if (osc.state === 'started') osc.stop(now);
  const fat = (osc as unknown as { _oscillator?: { frequency?: Tone.Signal; detune?: Tone.Signal; _oscillators?: unknown } })._oscillator;
  const inner = fat?._oscillators;
  if (fat && fat.frequency && fat.detune && Array.isArray(inner)) {
    for (const o of inner as Array<{ frequency?: Tone.Signal; detune?: Tone.Signal; _oscillator?: { state?: string; stop?: (t: number) => void } }>) {
      try {
        if (o.frequency) fat.frequency.disconnect(o.frequency);
        if (o.detune) fat.detune.disconnect(o.detune);
        // an inner node still inside its scheduled stop would be stopped untimed by dispose() (Tone warns once)
        const node = o._oscillator;
        if (node && node.state === 'started' && node.stop) node.stop(now);
      } catch {
        /* already detached */
      }
    }
  }
  osc.count = count;
  osc.spread = spread;
}

/** cents offset to move from `refHz` to `hz` (for driving filter.detune smoothly). */
export function centsBetween(refHz: number, hz: number): number {
  return 1200 * Math.log2(hz / refHz);
}

/**
 * Fixed-size voice allocator. Prefers the voice that has been idle the longest; if all are busy steals the one
 * whose note ends (incl. release) earliest - i.e. the quietest tail.
 */
export class VoiceAllocator {
  private readonly busyUntil: number[];
  private readonly lastUsed: number[];
  private counter = 0;

  constructor(readonly size: number) {
    this.busyUntil = new Array<number>(size).fill(0);
    this.lastUsed = new Array<number>(size).fill(0);
  }

  acquire(time: number): number {
    let best = -1;
    let bestUsed = Infinity;
    for (let i = 0; i < this.size; i++) {
      if (this.busyUntil[i]! <= time && this.lastUsed[i]! < bestUsed) {
        best = i;
        bestUsed = this.lastUsed[i]!;
      }
    }
    if (best >= 0) return best;
    let minBusy = Infinity;
    for (let i = 0; i < this.size; i++) {
      if (this.busyUntil[i]! < minBusy) {
        minBusy = this.busyUntil[i]!;
        best = i;
      }
    }
    return best;
  }

  claim(index: number, until: number): void {
    this.busyUntil[index] = until;
    this.lastUsed[index] = ++this.counter;
  }

  /** whether voice is free (idle) at `time` */
  isFree(index: number, time: number): boolean {
    return this.busyUntil[index]! <= time;
  }

  releaseAll(time: number, tailSeconds: number): void {
    for (let i = 0; i < this.size; i++) {
      if (this.busyUntil[i]! > time + tailSeconds) this.busyUntil[i] = time + tailSeconds;
    }
  }

  active(now: number): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.busyUntil[i]! > now) n++;
    return n;
  }
}
