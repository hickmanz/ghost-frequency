import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { FAST_RELEASE, centsBetween, rampParam, VoiceAllocator, type Instrument, type InstrumentParam } from './instrument';
import { dbToGain, logMap, midiToHz, saturationCurve } from '../mapping';
import { oscTrimDb } from '../oscTrim';
import { denorm, waveFromChoiceValue } from './paramApply';
import { getBuiltinPreset, getPreset, type BassPreset, type Wave } from '../presets';

const REF_HZ = 120;
const SAW_BASE_DB = -10.5;
const SUB_BASE_DB = -10.5;

/**
 * Mono analog-style bass: saw (-> resonant LP with envelope, parallel soft saturation) + sine sub, short glide.
 * The sub stays clean (it does not go through the saturator or the filter) so it is tight, not muddy.
 * Sound Lab: the main wave (triangle | sawtooth | square) and the sub wave (sine | triangle) are choices, applied only
 * while the (single) voice is idle: at the first note after it went silent, or by setPreset() when silent right now.
 * Both are plain single oscillators (a shape change is a property write, no node is created or disposed). Level trims
 * (oscTrim.ts) keep the loudness near the built-in sound.
 */
export class BassInstrument implements Instrument {
  readonly layer = 'bass' as const;
  readonly output: Tone.Gain;

  private readonly saw: Tone.MonoSynth;
  private readonly sub: Tone.Synth;
  private readonly shaper: Tone.WaveShaper;
  private readonly dry: Tone.Gain;
  private readonly wet: Tone.Gain;
  private readonly mix: Tone.Gain;
  private readonly hp: Tone.Filter;
  private readonly alloc = new VoiceAllocator(1);

  private mood: MoodId;
  private preset: BassPreset;
  private appliedWave: Wave;
  private appliedSubWave: Wave;
  private sawTrim = 0;
  private subTrim = 0;
  private filterPos: number;
  private automated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).bass;
    this.mood = mood;
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.appliedWave = p.wave;
    this.appliedSubWave = p.subWave;
    this.sawTrim = this.sawTrimFor(p.wave);
    this.subTrim = this.subTrimFor(p.subWave);

    this.saw = new Tone.MonoSynth({
      oscillator: { type: p.wave },
      envelope: { attack: 0.006, decay: p.ampDecay, sustain: p.sustain, release: p.release },
      filter: { type: 'lowpass', Q: p.q, rolloff: -24 },
      filterEnvelope: {
        attack: 0.005,
        decay: p.filterDecay,
        sustain: 0.15,
        release: 0.2,
        baseFrequency: REF_HZ,
        octaves: p.filterOctaves,
        exponent: 2,
      },
      portamento: p.glide,
      volume: SAW_BASE_DB + p.sawDb + this.sawTrim,
    });
    this.saw.filter.detune.value = centsBetween(REF_HZ, logMap(p.filterDefault, p.cutoffMin, p.cutoffMax));

    this.sub = new Tone.Synth({
      oscillator: { type: p.subWave },
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.9, release: Math.max(0.1, p.release) },
      portamento: p.glide,
      volume: SUB_BASE_DB + p.subDb + this.subTrim,
    });

    this.shaper = new Tone.WaveShaper(saturationCurve(2.5), 2048);
    this.shaper.oversample = '2x';
    this.dry = new Tone.Gain(1 - p.drive);
    this.wet = new Tone.Gain(p.drive);
    this.mix = new Tone.Gain(1);
    this.hp = new Tone.Filter({ type: 'highpass', frequency: 32, rolloff: -12 });
    this.output = new Tone.Gain(dbToGain(p.levelDb));

    this.saw.connect(this.dry);
    this.saw.connect(this.shaper);
    this.shaper.connect(this.wet);
    this.dry.connect(this.mix);
    this.wet.connect(this.mix);
    this.sub.connect(this.mix);
    this.mix.chain(this.hp, this.output);
  }

  private sawTrimFor(wave: Wave): number {
    return oscTrimDb('bass', wave, 1, getBuiltinPreset(this.mood).bass.wave, 1);
  }

  private subTrimFor(wave: Wave): number {
    return oscTrimDb('sub', wave, 1, getBuiltinPreset(this.mood).bass.subWave, 1);
  }

  /** Apply the preset's oscillator shapes (+ level trims). Only called while the voice is idle. */
  private syncOsc(): void {
    const p = this.preset;
    const sawTrim = this.sawTrimFor(p.wave);
    const subTrim = this.subTrimFor(p.subWave);
    if (p.wave === this.appliedWave && p.subWave === this.appliedSubWave && sawTrim === this.sawTrim && subTrim === this.subTrim) {
      return;
    }
    const now = Tone.now();
    if (p.wave !== this.appliedWave) this.saw.oscillator.baseType = p.wave;
    if (p.subWave !== this.appliedSubWave) this.sub.oscillator.baseType = p.subWave;
    this.appliedWave = p.wave;
    this.appliedSubWave = p.subWave;
    this.sawTrim = sawTrim;
    this.subTrim = subTrim;
    rampParam(this.saw.volume, SAW_BASE_DB + p.sawDb + sawTrim, now, 0);
    rampParam(this.sub.volume, SUB_BASE_DB + p.subDb + subTrim, now, 0);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    if (this.alloc.isFree(0, time)) this.syncOsc();
    const v = 0.3 + 0.7 * vel;
    const dur = Math.max(0.05, durSeconds);
    this.saw.envelope.decay = p.ampDecay;
    this.saw.envelope.sustain = p.sustain;
    this.saw.envelope.release = p.release;
    this.sub.envelope.release = Math.max(0.1, p.release); // also restores it after releaseAll()
    this.saw.filterEnvelope.decay = p.filterDecay;
    this.saw.filterEnvelope.octaves = p.filterOctaves * (0.6 + 0.4 * vel);
    this.saw.portamento = p.glide;
    this.sub.portamento = p.glide;
    // sub an octave down when that stays >= ~44 Hz, otherwise unison
    const subMidi = midi - 12 >= 28 ? midi - 12 : midi;
    this.saw.triggerAttackRelease(midiToHz(midi), dur, time, v);
    this.sub.triggerAttackRelease(midiToHz(subMidi), dur, time, v);
    this.alloc.claim(0, time + dur + p.release);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    const c = centsBetween(REF_HZ, logMap(value01, this.preset.cutoffMin, this.preset.cutoffMax));
    rampParam(this.saw.filter.detune, c, time, rampSeconds);
  }

  automateParam(presetKey: string, value01: number, time: number, rampSeconds = 0): void {
    if (!presetKey.startsWith('bass.')) return;
    const field = presetKey.slice(5);
    const native = denorm(presetKey, value01);
    if (native === null) return;
    const p = this.preset;
    switch (field) {
      case 'wave': {
        const w = waveFromChoiceValue(native);
        this.preset = { ...p, wave: w };
        if (this.alloc.isFree(0, time)) this.syncOsc();
        break;
      }
      case 'ampDecay':
        this.preset = { ...p, ampDecay: native };
        this.saw.envelope.decay = native;
        break;
      case 'drive':
        this.preset = { ...p, drive: native };
        rampParam(this.dry.gain, 1 - native, time, rampSeconds);
        rampParam(this.wet.gain, native, time, rampSeconds);
        break;
      case 'glide':
        this.preset = { ...p, glide: native };
        this.saw.portamento = native;
        this.sub.portamento = native;
        break;
      default:
        break;
    }
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).bass;
    this.mood = mood;
    this.preset = p;
    const now = Tone.now();
    if (this.alloc.isFree(0, now)) this.syncOsc();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    rampParam(this.saw.filter.detune, centsBetween(REF_HZ, logMap(this.filterPos, p.cutoffMin, p.cutoffMax)), now, rampSeconds);
    rampParam(this.saw.filter.Q, p.q, now, rampSeconds);
    rampParam(this.saw.volume, SAW_BASE_DB + p.sawDb + this.sawTrim, now, rampSeconds);
    rampParam(this.sub.volume, SUB_BASE_DB + p.subDb + this.subTrim, now, rampSeconds);
    rampParam(this.dry.gain, 1 - p.drive, now, rampSeconds);
    rampParam(this.wet.gain, p.drive, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    this.saw.envelope.release = FAST_RELEASE;
    this.sub.envelope.release = FAST_RELEASE;
    this.saw.triggerRelease(time);
    this.sub.triggerRelease(time);
    this.alloc.releaseAll(time, FAST_RELEASE);
  }

  getActiveVoices(): number {
    return this.alloc.active(Tone.now());
  }

  dispose(): void {
    this.saw.dispose();
    this.sub.dispose();
    this.shaper.dispose();
    this.dry.dispose();
    this.wet.dispose();
    this.mix.dispose();
    this.hp.dispose();
    this.output.dispose();
  }
}
