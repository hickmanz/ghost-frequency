import * as Tone from 'tone';
import { dbToGain, delaySeconds, safeCutoff } from './mapping';
import { MAX_DELAY_SECONDS, REVERB_IR, getPreset, type FxPreset } from './presets';
import { rampParam } from './instruments/instrument';
import { generateReverbIR } from './reverbIR';
import type { MoodId } from '@shared/index';

/**
 * Shared send/return effects:
 *  - ONE convolution reverb (synthetic IR generated once, synchronously; moods vary send/return level and tone,
 *    never the IR itself, so there is no async regeneration and no CPU spike).
 *  - tempo-synced stereo ping-pong delay with a low-pass inside the feedback loop (repeats get darker).
 * Inputs: `reverbIn`, `delayIn`. Output: `output` (summed returns), connect to the master bus.
 */
export class FxBus {
  readonly reverbIn: Tone.Gain;
  readonly delayIn: Tone.Gain;
  readonly output: Tone.Gain;

  private readonly convolver: Tone.Convolver;
  private readonly irBuffer: Tone.ToneAudioBuffer;
  private readonly reverbHp: Tone.Filter;
  private readonly reverbLp: Tone.Filter;
  private readonly reverbReturn: Tone.Gain;

  private readonly delayHp: Tone.Filter;
  private readonly delayL: Tone.Delay;
  private readonly delayR: Tone.Delay;
  private readonly lpA: Tone.Filter;
  private readonly lpB: Tone.Filter;
  private readonly fbA: Tone.Gain;
  private readonly fbB: Tone.Gain;
  private readonly panL: Tone.Panner;
  private readonly panR: Tone.Panner;
  private readonly delayOut: Tone.Gain;
  private readonly delayReturn: Tone.Gain;
  private readonly delayToReverb: Tone.Gain;

  private preset: FxPreset;
  private bpm = 100;
  private feedbackOn = true;
  private returnsMuted = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).fx;
    this.preset = p;
    const ctx = Tone.getContext();
    const sr = ctx.sampleRate;

    this.reverbIn = new Tone.Gain(1);
    this.delayIn = new Tone.Gain(1);
    this.output = new Tone.Gain(1);

    // ---- reverb
    const [l, r] = generateReverbIR({ sampleRate: sr, ...REVERB_IR });
    const buf = ctx.createBuffer(2, l.length, sr);
    buf.getChannelData(0).set(l);
    buf.getChannelData(1).set(r);
    this.irBuffer = new Tone.ToneAudioBuffer(buf);
    this.convolver = new Tone.Convolver();
    this.convolver.buffer = this.irBuffer;
    this.reverbHp = new Tone.Filter({ type: 'highpass', frequency: p.reverbHpHz, rolloff: -12 });
    this.reverbLp = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(p.reverbLpHz, sr), Q: 0.5, rolloff: -12 });
    this.reverbReturn = new Tone.Gain(dbToGain(p.reverbReturnDb));
    this.reverbIn.chain(this.reverbHp, this.convolver, this.reverbLp, this.reverbReturn, this.output);

    // ---- ping-pong delay: in -> L -> (lp, fb) -> R -> (lp, fb) -> L ...; L and R taps panned hard-ish
    const dt = delaySeconds(this.bpm, p.delayBeats, MAX_DELAY_SECONDS);
    this.delayHp = new Tone.Filter({ type: 'highpass', frequency: 200, rolloff: -12 });
    this.delayL = new Tone.Delay({ delayTime: dt, maxDelay: MAX_DELAY_SECONDS });
    this.delayR = new Tone.Delay({ delayTime: dt, maxDelay: MAX_DELAY_SECONDS });
    this.lpA = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(p.delayLpHz, sr), Q: 0.5, rolloff: -12 });
    this.lpB = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(p.delayLpHz, sr), Q: 0.5, rolloff: -12 });
    this.fbA = new Tone.Gain(p.delayFeedback);
    this.fbB = new Tone.Gain(p.delayFeedback);
    this.panL = new Tone.Panner(-0.8);
    this.panR = new Tone.Panner(0.8);
    this.delayOut = new Tone.Gain(1);
    this.delayReturn = new Tone.Gain(dbToGain(p.delayReturnDb));
    this.delayToReverb = new Tone.Gain(p.delayToReverb);

    this.delayIn.chain(this.delayHp, this.delayL);
    this.delayL.chain(this.lpA, this.fbA, this.delayR);
    this.delayR.chain(this.lpB, this.fbB, this.delayL);
    this.delayL.chain(this.panL, this.delayOut);
    this.delayR.chain(this.panR, this.delayOut);
    this.delayOut.chain(this.delayReturn, this.output);
    this.delayReturn.chain(this.delayToReverb, this.reverbIn);
  }

  /** Current tempo -> delay time (ramped so tempo changes give a gentle tape-like glide). */
  setTempo(bpm: number, time: number, rampSeconds = 0.4): void {
    this.bpm = bpm;
    const dt = delaySeconds(bpm, this.preset.delayBeats, MAX_DELAY_SECONDS);
    rampParam(this.delayL.delayTime, dt, time, rampSeconds);
    rampParam(this.delayR.delayTime, dt, time, rampSeconds);
  }

  /**
   * Ramp every fx parameter to the mood's (merged) preset. `glideDelayTime=false` (Sound Lab live tuning) skips the
   * slow delay-time glide: delayBeats is not tunable, so there is nothing to change and no pitchy artefacts.
   */
  setMood(mood: MoodId, rampSeconds: number, glideDelayTime = true): void {
    const p = getPreset(mood).fx;
    this.preset = p;
    const now = Tone.now();
    const sr = Tone.getContext().sampleRate;
    if (glideDelayTime) {
      const dt = delaySeconds(this.bpm, p.delayBeats, MAX_DELAY_SECONDS);
      // delay time glide: slower than the other ramps to avoid pitchy artefacts
      const dRamp = Math.max(rampSeconds, 0.5);
      rampParam(this.delayL.delayTime, dt, now, dRamp);
      rampParam(this.delayR.delayTime, dt, now, dRamp);
    }
    if (this.feedbackOn) {
      rampParam(this.fbA.gain, p.delayFeedback, now, rampSeconds);
      rampParam(this.fbB.gain, p.delayFeedback, now, rampSeconds);
    }
    rampParam(this.lpA.frequency, safeCutoff(p.delayLpHz, sr), now, rampSeconds);
    rampParam(this.lpB.frequency, safeCutoff(p.delayLpHz, sr), now, rampSeconds);
    rampParam(this.delayToReverb.gain, p.delayToReverb, now, rampSeconds);
    if (!this.returnsMuted) {
      rampParam(this.delayReturn.gain, dbToGain(p.delayReturnDb), now, rampSeconds);
      rampParam(this.reverbReturn.gain, dbToGain(p.reverbReturnDb), now, rampSeconds);
    }
    rampParam(this.reverbLp.frequency, safeCutoff(p.reverbLpHz, sr), now, rampSeconds);
    rampParam(this.reverbHp.frequency, p.reverbHpHz, now, rampSeconds);
  }

  /** Cut / restore delay regeneration (used by reset(): lets the repeats drain without re-feeding). */
  setFeedbackEnabled(on: boolean, time: number, rampSeconds = 0.05): void {
    this.feedbackOn = on;
    const g = on ? this.preset.delayFeedback : 0;
    rampParam(this.fbA.gain, g, time, rampSeconds);
    rampParam(this.fbB.gain, g, time, rampSeconds);
  }

  /** Mute/unmute the sends' return path (used while the master is faded out during reset). */
  setReturnsMuted(muted: boolean, time: number, rampSeconds = 0.05): void {
    this.returnsMuted = muted;
    const p = this.preset;
    rampParam(this.reverbReturn.gain, muted ? 0 : dbToGain(p.reverbReturnDb), time, rampSeconds);
    rampParam(this.delayReturn.gain, muted ? 0 : dbToGain(p.delayReturnDb), time, rampSeconds);
  }

  /**
   * Flush the reverb tail: re-assigning the buffer makes Tone swap in a fresh native ConvolverNode (empty state).
   * Only call while the output is silent. No IR regeneration happens (same AudioBuffer).
   */
  flushReverb(): void {
    this.convolver.buffer = this.irBuffer;
  }

  dispose(): void {
    for (const n of [
      this.reverbIn, this.delayIn, this.output, this.convolver, this.reverbHp, this.reverbLp, this.reverbReturn,
      this.delayHp, this.delayL, this.delayR, this.lpA, this.lpB, this.fbA, this.fbB, this.panL, this.panR,
      this.delayOut, this.delayReturn, this.delayToReverb,
    ]) {
      n.dispose();
    }
  }
}
