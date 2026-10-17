import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { dbToGain, logMap, midiToHz } from '../mapping';
import { oscTrimDb } from '../oscTrim';
import { UNISON_MAX, getBuiltinPreset, getPreset, type PadPreset, type Wave } from '../presets';
import { denorm, waveFromChoiceValue } from './paramApply';
import { FAST_RELEASE, clampCount, rampParam, setFatCount, VoiceAllocator, type Instrument, type InstrumentParam } from './instrument';

/** Voices in the pool. Each voice = 1..5 detuned oscillators (3 by default); long releases need headroom for overlap. */
export const PAD_VOICES = 12;
const VOICE_DB = -9; // per voice (3 summed saws; tuned by offline measurement) + wave/unison trim (oscTrim.ts)

/**
 * Warm analog-ish pad: pool of fat-saw voices -> shared low-pass (slow LFO on detune) -> HP -> chorus -> widener.
 * Sound Lab: wave shape and stacked-oscillator count are applied to a voice only while it is idle (its next note, or
 * setPreset() on voices idle right now); a level trim (oscTrim.ts) keeps the loudness near the built-in sound.
 */
export class PadInstrument implements Instrument {
  readonly layer = 'pad' as const;
  readonly output: Tone.Gain;

  private readonly voices: Tone.Synth[] = [];
  private mood: MoodId;
  private readonly appliedWave: Wave[] = [];
  private readonly appliedCount: number[] = [];
  private readonly appliedTrim: number[] = [];
  private readonly alloc = new VoiceAllocator(PAD_VOICES);
  private readonly filter: Tone.Filter;
  private readonly hp: Tone.Filter;
  private readonly chorus: Tone.Chorus;
  private readonly widener: Tone.StereoWidener;
  private readonly lfo: Tone.LFO;

  private preset: PadPreset;
  private filterPos: number;
  private automated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).pad;
    this.mood = mood;
    this.preset = p;
    this.filterPos = p.filterDefault;
    const count = clampCount(p.unison, UNISON_MAX.pad);
    const trim = this.trimFor(p.baseType, count);

    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: logMap(p.filterDefault, p.cutoffMin, p.cutoffMax),
      Q: p.q,
      rolloff: -24,
    });
    this.hp = new Tone.Filter({ type: 'highpass', frequency: 90, rolloff: -12 });
    this.chorus = new Tone.Chorus({
      frequency: p.chorusRate,
      delayTime: p.chorusDelayMs,
      depth: p.chorusDepth,
      wet: p.chorusWet,
      spread: 180,
    }).start();
    this.widener = new Tone.StereoWidener(p.width);

    // slow filter LFO (log-domain via detune in cents); depth is scaled with `amplitude` so it can be ramped
    this.lfo = new Tone.LFO({ frequency: p.lfoRate, min: -1000, max: 1000, units: 'cents', type: 'sine' });
    this.lfo.amplitude.value = p.lfoDepthCents / 1000;
    this.lfo.connect(this.filter.detune);
    this.lfo.start();

    for (let i = 0; i < PAD_VOICES; i++) {
      const v = new Tone.Synth({
        oscillator: { type: `fat${p.baseType}`, count, spread: p.spread } as Tone.OmniOscillatorOptions,
        envelope: {
          attack: p.attack,
          decay: p.decay,
          sustain: p.sustain,
          release: p.release,
          attackCurve: 'sine',
          releaseCurve: 'exponential',
        },
        volume: VOICE_DB + trim,
      });
      v.connect(this.filter);
      this.voices.push(v);
      this.appliedWave.push(p.baseType);
      this.appliedCount.push(count);
      this.appliedTrim.push(trim);
    }
    this.filter.chain(this.hp, this.chorus, this.widener, this.output);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const idx = this.alloc.acquire(time);
    const v = this.voices[idx]!;
    // keep the swell audible even for short notes
    const dur = Math.max(durSeconds, p.attack * 0.8 + 0.25);
    // wave / unison: only on a voice that is idle at the note start (never on a stolen, still sounding one)
    if (this.alloc.isFree(idx, time)) this.syncVoice(idx);
    v.envelope.attack = p.attack;
    v.envelope.decay = p.decay;
    v.envelope.sustain = p.sustain;
    v.envelope.release = p.release;
    v.triggerAttackRelease(midiToHz(midi), dur, time, 0.25 + 0.75 * vel);
    this.alloc.claim(idx, time + dur + p.release);
  }

  /** Level trim (dB) of a wave x count relative to this mood's built-in configuration. */
  private trimFor(wave: Wave, count: number): number {
    const ref = getBuiltinPreset(this.mood).pad;
    return oscTrimDb('pad', wave, count, ref.baseType, clampCount(ref.unison, UNISON_MAX.pad));
  }

  /** Make an IDLE voice use the preset's wave / unison count (+ level trim). Never called for a sounding voice. */
  private syncVoice(i: number): void {
    const p = this.preset;
    const wave = p.baseType;
    const count = clampCount(p.unison, UNISON_MAX.pad);
    const trim = this.trimFor(wave, count);
    if (this.appliedWave[i] === wave && this.appliedCount[i] === count && this.appliedTrim[i] === trim) return;
    const v = this.voices[i]!;
    const now = Tone.now();
    v.oscillator.baseType = wave;
    if (this.appliedCount[i] !== count) {
      setFatCount(v.oscillator, count, p.spread, now); // re-creates the inner oscillators: only while the voice is silent
    }
    rampParam(v.volume, VOICE_DB + trim, now, 0);
    this.appliedWave[i] = wave;
    this.appliedCount[i] = count;
    this.appliedTrim[i] = trim;
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    const p = this.preset;
    rampParam(this.filter.frequency, logMap(value01, p.cutoffMin, p.cutoffMax), time, rampSeconds);
  }

  automateParam(presetKey: string, value01: number, time: number, rampSeconds = 0): void {
    if (!presetKey.startsWith('pad.')) return;
    const field = presetKey.slice(4);
    const native = denorm(presetKey, value01);
    if (native === null) return;
    const p = this.preset;
    switch (field) {
      case 'attack':
        this.preset = { ...p, attack: native };
        for (const v of this.voices) v.envelope.attack = native;
        break;
      case 'release':
        this.preset = { ...p, release: native };
        for (const v of this.voices) v.envelope.release = native;
        break;
      case 'baseType': {
        const w = waveFromChoiceValue(native);
        this.preset = { ...p, baseType: w };
        for (let i = 0; i < this.voices.length; i++) if (this.alloc.isFree(i, time)) this.syncVoice(i);
        break;
      }
      case 'chorusWet':
        this.preset = { ...p, chorusWet: native };
        rampParam(this.chorus.wet, native, time, rampSeconds);
        break;
      case 'spread':
        this.preset = { ...p, spread: native };
        for (const v of this.voices) v.oscillator.spread = native;
        break;
      case 'lfoRate':
        this.preset = { ...p, lfoRate: native };
        rampParam(this.lfo.frequency, native, time, rampSeconds);
        break;
      case 'lfoDepthCents':
        this.preset = { ...p, lfoDepthCents: native };
        rampParam(this.lfo.amplitude, native / 1000, time, rampSeconds);
        break;
      default:
        break;
    }
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).pad;
    const prev = this.preset;
    this.mood = mood;
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    rampParam(this.filter.frequency, logMap(this.filterPos, p.cutoffMin, p.cutoffMax), now, rampSeconds);
    rampParam(this.filter.Q, p.q, now, rampSeconds);
    rampParam(this.lfo.frequency, p.lfoRate, now, rampSeconds);
    rampParam(this.lfo.amplitude, p.lfoDepthCents / 1000, now, rampSeconds);
    rampParam(this.chorus.wet, p.chorusWet, now, rampSeconds);
    rampParam(this.chorus.frequency, p.chorusRate, now, rampSeconds);
    if (p.chorusDepth !== prev.chorusDepth) this.chorus.depth = p.chorusDepth;
    if (p.chorusDelayMs !== prev.chorusDelayMs) this.chorus.delayTime = p.chorusDelayMs;
    rampParam(this.widener.width, p.width, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    if (p.spread !== prev.spread) for (const v of this.voices) v.oscillator.spread = p.spread;
    // envelope + waveform / unison changes are applied per note (see trigger) and right now to voices that are idle
    for (let i = 0; i < this.voices.length; i++) if (this.alloc.isFree(i, now)) this.syncVoice(i);
  }

  releaseAll(time = Tone.now()): void {
    for (const v of this.voices) {
      v.envelope.release = FAST_RELEASE; // restored on the next trigger
      v.triggerRelease(time);
    }
    this.alloc.releaseAll(time, FAST_RELEASE);
  }

  getActiveVoices(): number {
    return this.alloc.active(Tone.now());
  }

  dispose(): void {
    for (const v of this.voices) v.dispose();
    this.lfo.dispose();
    this.filter.dispose();
    this.hp.dispose();
    this.chorus.dispose();
    this.widener.dispose();
    this.output.dispose();
  }
}
