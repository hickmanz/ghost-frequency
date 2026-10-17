import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { dbToGain, midiToHz } from '../mapping';
import { FAST_RELEASE, type Instrument, type InstrumentParam } from './instrument';

/**
 * Sparse FM bell. Fixed timbre (no Sound Lab page): sine carrier, sine modulator a
 * little sharp of the second harmonic, short index so it stays soft in the pad.
 * Other engines never schedule this layer, so the fader stays silent for them.
 */
export class BellInstrument implements Instrument {
  readonly layer = 'bell' as const;
  readonly output: Tone.Gain;

  private readonly synth: Tone.PolySynth;

  constructor(_mood: MoodId) {
    this.synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2.01,
      modulationIndex: 2.2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.04, decay: 1.5, sustain: 0.1, release: 2.2 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.04, release: 0.5 },
    });
    this.synth.maxPolyphony = 4;
    this.synth.volume.value = -8;
    this.output = new Tone.Gain(dbToGain(-6));
    this.synth.connect(this.output);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    this.synth.triggerAttackRelease(midiToHz(midi), Math.max(0.08, durSeconds), time, Math.min(0.7, vel));
  }

  automate(_param: InstrumentParam, _value01: number, _time: number, _rampSeconds = 0): void {}

  setPreset(_mood: MoodId, _rampSeconds: number, _resetAutomation?: boolean): void {}

  releaseAll(time?: number): void {
    const t = time ?? Tone.now();
    this.synth.releaseAll(t + FAST_RELEASE);
  }

  getActiveVoices(): number {
    return 0;
  }

  dispose(): void {
    this.synth.dispose();
    this.output.dispose();
  }
}
