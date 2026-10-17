import * as Tone from 'tone';
import type { LayerId } from '@shared/index';
import { faderToGain, layerAutomationGain } from './mapping';
import { rampParam, type Instrument } from './instruments/instrument';

/** Static pan per layer (instruments are already stereo; keep the centre-heavy layers centred). */
const LAYER_PAN: Record<LayerId, number> = { pad: 0, arp: 0, bass: 0, lead: 0.06, drums: 0, texture: 0, bell: 0.15 };

/**
 * One channel strip per layer:
 *   instrument.output -> autoGain ('layer.gain.<layer>' automation) -> gate (pause) -> monitor (Sound Lab mute/solo)
 *   -> fader (user mixer) -> panner -> dry (master input)  +  reverbSend -> fx.reverbIn  +  delaySend -> fx.delayIn
 * Fader, automation gain and mute/solo ("monitor") are separate gain stages so they multiply.
 * Sends are post-fader/post-gate/post-monitor, so a muted layer also stops feeding reverb/delay (tails already in the
 * reverb/delay returns keep ringing naturally).
 */
export class ChannelStrip {
  readonly auto: Tone.Gain;
  readonly gate: Tone.Gain;
  readonly monitor: Tone.Gain;
  readonly fader: Tone.Gain;
  readonly panner: Tone.Panner;
  readonly reverbSend: Tone.Gain;
  readonly delaySend: Tone.Gain;
  /** Kick duck for pad/texture. Stays at unity unless a composer emits duck.* events. */
  readonly duck: Tone.Gain;

  private faderValue = 0.7;
  constructor(readonly layer: LayerId, instrument: Instrument, dryOut: Tone.ToneAudioNode, reverbIn: Tone.ToneAudioNode, delayIn: Tone.ToneAudioNode) {
    this.auto = new Tone.Gain(1);
    this.gate = new Tone.Gain(1);
    this.monitor = new Tone.Gain(1);
    this.fader = new Tone.Gain(0); // opened by setFader() at construction time (no start-up burst)
    this.panner = new Tone.Panner(LAYER_PAN[layer]);
    this.reverbSend = new Tone.Gain(0);
    this.delaySend = new Tone.Gain(0);
    this.duck = new Tone.Gain(1);

    instrument.output.chain(this.auto, this.duck, this.gate, this.monitor, this.fader, this.panner, dryOut);
    this.panner.connect(this.reverbSend);
    this.reverbSend.connect(reverbIn);
    this.panner.connect(this.delaySend);
    this.delaySend.connect(delayIn);
  }

  setFader(value01: number, time = Tone.now(), rampSeconds = 0.05): void {
    this.faderValue = value01;
    this.applyFader(time, rampSeconds);
  }

  /** Sound Lab mute/solo stage: `audible` false => silent (ramped, click-free). Independent of fader/automation. */
  setAudible(audible: boolean, time = Tone.now(), rampSeconds = 0.04): void {
    rampParam(this.monitor.gain, audible ? 1 : 0, time, rampSeconds);
  }

  private applyFader(time: number, rampSeconds: number): void {
    rampParam(this.fader.gain, faderToGain(this.faderValue), time, rampSeconds);
  }

  /** 'layer.gain.<layer>' automation */
  setAutomationGain(value01: number, time: number, rampSeconds: number): void {
    rampParam(this.auto.gain, layerAutomationGain(value01), time, rampSeconds);
  }

  /** 'duck.pad' / 'duck.texture': linear gain, independent of the section fade. */
  setDuck(value01: number, time: number, rampSeconds: number): void {
    const g = value01 < 0 ? 0 : value01 > 1 ? 1 : value01;
    rampParam(this.duck.gain, g, time, rampSeconds);
  }

  setGate(open: boolean, time: number, rampSeconds: number): void {
    rampParam(this.gate.gain, open ? 1 : 0, time, rampSeconds);
  }

  /** Send gains are base(mood) * bus multiplier (send.reverb/send.delay automation). */
  setSends(reverb: number, delay: number, time: number, rampSeconds: number): void {
    rampParam(this.reverbSend.gain, reverb, time, rampSeconds);
    rampParam(this.delaySend.gain, delay, time, rampSeconds);
  }

  /** Back to neutral automation state (used by reset). */
  resetAutomation(time: number): void {
    this.auto.gain.cancelScheduledValues(time);
    this.auto.gain.setValueAtTime(1, time);
    this.duck.gain.cancelScheduledValues(time);
    this.duck.gain.setValueAtTime(1, time);
  }

  dispose(): void {
    for (const n of [this.auto, this.duck, this.gate, this.monitor, this.fader, this.panner, this.reverbSend, this.delaySend]) n.dispose();
  }
}
