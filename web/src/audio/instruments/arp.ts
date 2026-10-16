import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { FAST_RELEASE, centsBetween, clampCount, rampParam, setFatCount, VoiceAllocator, type Instrument, type InstrumentParam } from './instrument';
import { dbToGain, logMap, midiToHz } from '../mapping';
import { oscTrimDb } from '../oscTrim';
import { UNISON_MAX, getBuiltinPreset, getPreset, type ArpPreset, type Wave } from '../presets';

export const ARP_VOICES = 8;
/** 3 stacked saws are ~5 dB hotter than the old single pulse, so trim per voice (plus the wave/unison trim, oscTrim.ts). */
const VOICE_DB = -10;
/** Filter envelope base frequency is fixed; the cutoff is steered with filter.detune (smooth, log-domain). */
const REF_HZ = 400;

/**
 * Soft supersaw pluck: pool of MonoSynths (3 detuned saws -> LP w/ filter envelope -> amp env) -> chorus -> auto-panner.
 * Sound Lab: the wave shape and the number of stacked oscillators (1..5) are choices. They are applied to a voice only
 * while it is idle (at its next note, or by setPreset() on voices that are idle right now), so a sounding note is never
 * disturbed and no node is disposed while it sounds. A trim (oscTrim.ts) keeps the level close to the built-in sound.
 * (A single bare pulse wave here sounded like chiptune / video-game music, so it is deliberately avoided.)
 * Velocity scales both amplitude and filter-envelope peak (=> brighter when louder).
 * Tempo-synced ping-pong delay comes from the channel strip's delay send.
 */
export class ArpInstrument implements Instrument {
  readonly layer = 'arp' as const;
  readonly output: Tone.Gain;

  private readonly voices: Tone.MonoSynth[] = [];
  private readonly alloc = new VoiceAllocator(ARP_VOICES);
  private readonly sum: Tone.Gain;
  private readonly chorus: Tone.Chorus;
  private readonly panner: Tone.AutoPanner;

  private mood: MoodId;
  private preset: ArpPreset;
  /** per voice: the wave / stacked-oscillator count that is actually applied to the voice's oscillator */
  private readonly appliedWave: Wave[] = [];
  private readonly appliedCount: number[] = [];
  private readonly appliedTrim: number[] = [];
  private filterPos: number;
  private automated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).arp;
    this.mood = mood;
    this.preset = p;
    this.filterPos = p.filterDefault;
    const count = clampCount(p.unison, UNISON_MAX.arp);
    const cents = centsBetween(REF_HZ, logMap(p.filterDefault, p.cutoffMin, p.cutoffMax));

    this.sum = new Tone.Gain(1);
    this.chorus = new Tone.Chorus({ frequency: 0.9, delayTime: 3.2, depth: 0.55, wet: p.chorusWet, spread: 180 }).start();
    this.panner = new Tone.AutoPanner({ frequency: p.panRate, depth: p.panDepth, type: 'sine' }).start();
    this.output = new Tone.Gain(dbToGain(p.levelDb));

    for (let i = 0; i < ARP_VOICES; i++) {
      const v = new Tone.MonoSynth({
        oscillator: { type: `fat${p.wave}`, count, spread: p.spread } as Tone.OmniOscillatorOptions,
        envelope: { attack: p.attack, decay: p.decay, sustain: 0.0, release: p.release, attackCurve: 'linear' },
        filter: { type: 'lowpass', Q: p.q, rolloff: -24 },
        filterEnvelope: {
          attack: 0.002,
          decay: p.filterDecay,
          sustain: 0.05,
          release: 0.3,
          baseFrequency: REF_HZ,
          octaves: p.filterOctaves,
          exponent: 2,
        },
        volume: VOICE_DB + this.trimFor(p.wave, count),
      });
      v.filter.detune.value = cents;
      v.connect(this.sum);
      this.voices.push(v);
      this.appliedWave.push(p.wave);
      this.appliedCount.push(count);
      this.appliedTrim.push(this.trimFor(p.wave, count));
    }
    this.sum.chain(this.chorus, this.panner, this.output);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const idx = this.alloc.acquire(time);
    const v = this.voices[idx]!;
    const p = this.preset;
    // wave / unison: only on a voice that is idle at the note start (never on a stolen, still sounding one)
    if (this.alloc.isFree(idx, time)) this.syncVoice(idx);
    // per-note envelope shape (read at trigger time so Sound Lab changes are heard on the next note)
    v.envelope.attack = p.attack;
    v.envelope.decay = p.decay;
    v.envelope.release = p.release;
    v.filterEnvelope.decay = p.filterDecay;
    // MonoSynth does not pass velocity to the filter envelope -> velocity -> brightness is done here
    v.filterEnvelope.octaves = p.filterOctaves * (0.4 + 0.6 * vel);
    const dur = Math.max(0.03, Math.min(durSeconds, 1.5));
    v.triggerAttackRelease(midiToHz(midi), dur, time, 0.2 + 0.8 * vel);
    this.alloc.claim(idx, time + dur + p.release + 0.05);
  }

  /** Level trim (dB) of a wave x count relative to this mood's built-in configuration. */
  private trimFor(wave: Wave, count: number): number {
    const ref = getBuiltinPreset(this.mood).arp;
    return oscTrimDb('arp', wave, count, ref.wave, clampCount(ref.unison, UNISON_MAX.arp));
  }

  /**
   * Make an IDLE voice use the preset's wave / unison count (and the matching level trim). Changing the shape of a
   * Tone fat oscillator is a plain property write; changing the count re-creates its inner oscillators, which is
   * only done here, while the voice is silent. No new synth is created.
   */
  private syncVoice(i: number): void {
    const p = this.preset;
    const wave = p.wave;
    const count = clampCount(p.unison, UNISON_MAX.arp);
    const trim = this.trimFor(wave, count);
    if (this.appliedWave[i] === wave && this.appliedCount[i] === count && this.appliedTrim[i] === trim) return;
    const v = this.voices[i]!;
    const now = Tone.now();
    v.oscillator.baseType = wave;
    if (this.appliedCount[i] !== count) {
      setFatCount(v.oscillator, count, p.spread, now);
    }
    rampParam(v.volume, VOICE_DB + trim, now, 0);
    this.appliedWave[i] = wave;
    this.appliedCount[i] = count;
    this.appliedTrim[i] = trim;
  }

  private cutoffCents(pos: number, p: ArpPreset): number {
    return centsBetween(REF_HZ, logMap(pos, p.cutoffMin, p.cutoffMax));
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    const c = this.cutoffCents(value01, this.preset);
    for (const v of this.voices) rampParam(v.filter.detune, c, time, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).arp;
    const spreadChanged = p.spread !== this.preset.spread;
    this.mood = mood; // the level trim is relative to the built-in preset of the mood
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    const c = this.cutoffCents(this.filterPos, p);
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!;
      rampParam(v.filter.detune, c, now, rampSeconds);
      rampParam(v.filter.Q, p.q, now, rampSeconds);
      // detune spread is a plain property on the fat oscillator; changing it while sounding is safe (no re-creation)
      if (spreadChanged) v.oscillator.spread = p.spread;
      if (this.alloc.isFree(i, now)) this.syncVoice(i);
    }
    rampParam(this.chorus.wet, p.chorusWet, now, rampSeconds);
    rampParam(this.panner.frequency, p.panRate, now, rampSeconds);
    rampParam(this.panner.depth, p.panDepth, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    for (const v of this.voices) {
      v.envelope.release = FAST_RELEASE;
      v.triggerRelease(time);
    }
    this.alloc.releaseAll(time, FAST_RELEASE);
  }

  getActiveVoices(): number {
    return this.alloc.active(Tone.now());
  }

  dispose(): void {
    for (const v of this.voices) v.dispose();
    this.sum.dispose();
    this.chorus.dispose();
    this.panner.dispose();
    this.output.dispose();
  }
}
