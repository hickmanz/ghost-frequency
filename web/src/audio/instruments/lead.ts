import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { FAST_RELEASE, centsBetween, clampCount, rampParam, setFatCount, VoiceAllocator, type Instrument, type InstrumentParam } from './instrument';
import { dbToGain, logMap, midiToHz } from '../mapping';
import { oscTrimDb } from '../oscTrim';
import { UNISON_MAX, getBuiltinPreset, getPreset, type LeadPreset, type Wave } from '../presets';

const REF_HZ = 600;
const BASE_DB = -9;

/**
 * Mono Vangelis-ish lead: DuoSynth (saw + slightly detuned square, each with its own resonant LP + filter env),
 * portamento, vibrato that fades in on long notes. Big delay/reverb comes from the channel strip sends.
 * Sound Lab: voice0's wave + stacked-oscillator count (1..4) and voice1's wave are choices. They are applied only while
 * the (single) voice is idle: at the first note after it went silent, or by setPreset() when it is silent right now.
 * Level trims (oscTrim.ts) keep the loudness near the built-in sound.
 */
export class LeadInstrument implements Instrument {
  readonly layer = 'lead' as const;
  readonly output: Tone.Gain;

  private readonly synth: Tone.DuoSynth;
  private readonly chorus: Tone.Chorus;
  private readonly alloc = new VoiceAllocator(1);

  private mood: MoodId;
  private preset: LeadPreset;
  /** wave / count actually applied to the oscillators (and the level trims that go with them) */
  private appliedWave0: Wave;
  private appliedCount0: number;
  private appliedWave1: Wave;
  private trim0 = 0;
  private trim1 = 0;
  private filterPos: number;
  private automated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).lead;
    this.mood = mood;
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.appliedWave0 = p.wave0;
    this.appliedCount0 = clampCount(p.unison0, UNISON_MAX.lead0);
    this.appliedWave1 = p.wave1;
    this.trim0 = this.trim0For(this.appliedWave0, this.appliedCount0);
    this.trim1 = this.trim1For(this.appliedWave1);

    // Two slightly detuned saws (voice1 sits `harmonicity` above voice0). A square here sounded hollow/chiptune-like.
    const mkVoice = (fat: boolean) => ({
      oscillator: (fat
        ? { type: `fat${p.wave0}`, count: this.appliedCount0, spread: 14 }
        : { type: p.wave1 }) as Tone.OmniOscillatorOptions,
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
      filter: { type: 'lowpass' as const, Q: p.q, rolloff: -24 as const },
      filterEnvelope: {
        attack: 0.02,
        decay: p.filterDecay,
        sustain: 0.4,
        release: 0.6,
        baseFrequency: REF_HZ,
        octaves: p.filterOctaves,
        exponent: 2,
      },
    });
    this.synth = new Tone.DuoSynth({
      harmonicity: p.harmonicity,
      vibratoAmount: 0,
      vibratoRate: p.vibratoRate,
      portamento: p.portamento,
      voice0: mkVoice(true),
      voice1: mkVoice(false),
    });
    this.synth.voice0.volume.value = BASE_DB + p.sawDb + this.trim0;
    this.synth.voice1.volume.value = BASE_DB + p.squareDb + this.trim1;
    const cents = centsBetween(REF_HZ, logMap(p.filterDefault, p.cutoffMin, p.cutoffMax));
    this.synth.voice0.filter.detune.value = cents;
    this.synth.voice1.filter.detune.value = cents;

    this.chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.5, wet: p.chorusWet, spread: 150 }).start();
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.synth.chain(this.chorus, this.output);
  }

  private trim0For(wave: Wave, count: number): number {
    const ref = getBuiltinPreset(this.mood).lead;
    return oscTrimDb('lead0', wave, count, ref.wave0, clampCount(ref.unison0, UNISON_MAX.lead0));
  }

  private trim1For(wave: Wave): number {
    const ref = getBuiltinPreset(this.mood).lead;
    return oscTrimDb('lead1', wave, 1, ref.wave1, 1);
  }

  /**
   * Apply the preset's oscillator choices (+ level trims). Only called while the voice is idle: a shape change is a
   * property write, a count change re-creates voice0's inner oscillators (silent at this point).
   */
  private syncOsc(): void {
    const p = this.preset;
    const s = this.synth;
    const wave0 = p.wave0;
    const count0 = clampCount(p.unison0, UNISON_MAX.lead0);
    const wave1 = p.wave1;
    const trim0 = this.trim0For(wave0, count0);
    const trim1 = this.trim1For(wave1);
    if (
      wave0 === this.appliedWave0 && count0 === this.appliedCount0 && wave1 === this.appliedWave1 &&
      trim0 === this.trim0 && trim1 === this.trim1
    ) {
      return;
    }
    const now = Tone.now();
    if (wave0 !== this.appliedWave0) s.voice0.oscillator.baseType = wave0;
    if (count0 !== this.appliedCount0) {
      setFatCount(s.voice0.oscillator, count0, 14, now);
    }
    if (wave1 !== this.appliedWave1) s.voice1.oscillator.baseType = wave1;
    this.appliedWave0 = wave0;
    this.appliedCount0 = count0;
    this.appliedWave1 = wave1;
    this.trim0 = trim0;
    this.trim1 = trim1;
    rampParam(s.voice0.volume, BASE_DB + p.sawDb + trim0, now, 0);
    rampParam(s.voice1.volume, BASE_DB + p.squareDb + trim1, now, 0);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const dur = Math.max(0.06, durSeconds);
    const s = this.synth;
    if (this.alloc.isFree(0, time)) this.syncOsc();
    for (const v of [s.voice0, s.voice1]) {
      v.envelope.attack = p.attack;
      v.envelope.decay = p.decay;
      v.envelope.sustain = p.sustain;
      v.envelope.release = p.release;
      v.filterEnvelope.decay = p.filterDecay;
      v.filterEnvelope.octaves = p.filterOctaves * (0.5 + 0.5 * vel);
    }
    s.portamento = p.portamento;
    // vibrato fades in on sustained notes (restarted at each note)
    const amt = s.vibratoAmount;
    amt.cancelScheduledValues(time);
    amt.setValueAtTime(0, time);
    amt.setValueAtTime(0, time + p.vibratoDelay);
    amt.linearRampToValueAtTime(p.vibratoAmount, time + p.vibratoDelay + p.vibratoFade);
    s.triggerAttackRelease(midiToHz(midi), dur, time, 0.3 + 0.7 * vel);
    this.alloc.claim(0, time + dur + p.release);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    const c = centsBetween(REF_HZ, logMap(value01, this.preset.cutoffMin, this.preset.cutoffMax));
    rampParam(this.synth.voice0.filter.detune, c, time, rampSeconds);
    rampParam(this.synth.voice1.filter.detune, c, time, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).lead;
    this.mood = mood;
    this.preset = p;
    const now = Tone.now();
    const s = this.synth;
    if (this.alloc.isFree(0, now)) this.syncOsc();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    const c = centsBetween(REF_HZ, logMap(this.filterPos, p.cutoffMin, p.cutoffMax));
    for (const v of [s.voice0, s.voice1]) {
      rampParam(v.filter.detune, c, now, rampSeconds);
      rampParam(v.filter.Q, p.q, now, rampSeconds);
    }
    rampParam(s.voice0.volume, BASE_DB + p.sawDb + this.trim0, now, rampSeconds);
    rampParam(s.voice1.volume, BASE_DB + p.squareDb + this.trim1, now, rampSeconds);
    rampParam(s.harmonicity, p.harmonicity, now, rampSeconds);
    rampParam(s.vibratoRate, p.vibratoRate, now, rampSeconds);
    rampParam(this.chorus.wet, p.chorusWet, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    this.synth.voice0.envelope.release = FAST_RELEASE;
    this.synth.voice1.envelope.release = FAST_RELEASE;
    this.synth.triggerRelease(time);
    this.alloc.releaseAll(time, FAST_RELEASE);
  }

  getActiveVoices(): number {
    return this.alloc.active(Tone.now());
  }

  dispose(): void {
    this.synth.dispose();
    this.chorus.dispose();
    this.output.dispose();
  }
}
