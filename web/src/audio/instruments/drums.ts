import * as Tone from 'tone';
import { DRUM, type MoodId } from '@shared/index';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';
import { dbToGain, midiToHz, safeCutoff } from '../mapping';
import { getPreset, type DrumPreset } from '../presets';
import type { DrumSampleName, DrumSampleSet } from '../samples';

/** Extra gain (dB) applied on top of the preset level when a real (normalised) sample is used instead of the synth. */
const SAMPLE_OFFSET_DB: Record<DrumSampleName, number> = { kick: 2, snare: 4, clap: 4, hat: 10, openhat: 10 };

interface SampleVoice {
  player: Tone.Player;
  gain: Tone.Gain;
}

/**
 * Restrained 80s-electronic drum kit. Every drum has a synthesized implementation (always available);
 * optional one-shot samples (kick/snare/clap/hat/openhat) replace individual voices once loaded.
 *  - kick: MembraneSynth with pitch envelope (soft, round)
 *  - snare: filtered noise + short pitched body + gated-noise "reverb" tail
 *  - clap: several rapid noise bursts + short tail
 *  - hats: high-passed noise (closed chokes open)
 */
export class DrumsInstrument implements Instrument {
  readonly layer = 'drums' as const;
  readonly output: Tone.Gain;

  private readonly bus: Tone.Gain;
  private readonly ceiling: Tone.Filter;

  private readonly kick: Tone.MembraneSynth;
  private readonly snareNoise: Tone.NoiseSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly snareTail: Tone.NoiseSynth;
  private readonly clap: Tone.NoiseSynth;
  private readonly hat: Tone.NoiseSynth;
  private readonly openHat: Tone.NoiseSynth;
  private readonly crash: Tone.NoiseSynth;
  private readonly tom: Tone.MembraneSynth;
  private readonly filters: Tone.Filter[] = [];
  private readonly hatHp: Tone.Filter;
  private readonly openHp: Tone.Filter;

  private readonly samples: Partial<Record<DrumSampleName, SampleVoice>> = {};
  private preset: DrumPreset;
  private busyUntil = 0;

  constructor(mood: MoodId) {
    const p = getPreset(mood).drums;
    this.preset = p;

    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.ceiling = new Tone.Filter({ type: 'lowpass', frequency: p.ceilingHz, Q: 0.5, rolloff: -12 });
    this.bus = new Tone.Gain(1);
    this.bus.chain(this.ceiling, this.output);

    const mkFilter = (type: BiquadFilterType, freq: number, q = 0.7): Tone.Filter => {
      const f = new Tone.Filter({ type, frequency: freq, Q: q, rolloff: -12 });
      this.filters.push(f);
      return f;
    };

    // kick
    this.kick = new Tone.MembraneSynth({
      pitchDecay: p.kickPitchDecay,
      octaves: p.kickPitchOct,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: p.kickDecay, sustain: 0, release: 0.1, attackCurve: 'linear' },
      volume: p.kickDb,
    }).connect(this.bus);

    // snare = noise + body + gated tail
    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: p.snareNoiseDecay, sustain: 0, release: 0.05 },
      volume: p.snareDb,
    }).chain(mkFilter('highpass', 1300), this.bus);
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 0.9,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
      volume: p.snareDb - 5,
    }).connect(this.bus);
    this.snareTail = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.006, decay: 0.05, sustain: 0.55, release: 0.05 },
      volume: p.snareTailDb,
    }).chain(mkFilter('bandpass', 1800, 0.6), mkFilter('lowpass', 5500, 0.5), this.bus);

    // clap
    this.clap = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.04 },
      volume: p.clapDb,
    }).chain(mkFilter('bandpass', 1500, 0.9), this.bus);

    // hats
    this.hatHp = mkFilter('highpass', p.hatHpHz, 0.5);
    this.hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: p.hatDecay, sustain: 0, release: 0.02 },
      volume: p.hatDb,
    }).chain(this.hatHp, this.bus);
    this.openHp = mkFilter('highpass', p.hatHpHz, 0.5);
    this.openHat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.002, decay: p.openHatDecay, sustain: 0, release: 0.08 },
      volume: p.openHatDb,
    }).chain(this.openHp, this.bus);

    // crash
    this.crash = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.003, decay: 1.6, sustain: 0, release: 0.3 },
      volume: p.crashDb,
    }).chain(mkFilter('highpass', 5000, 0.5), this.bus);

    // tom
    this.tom = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 1.5,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.1 },
      volume: p.tomDb,
    }).connect(this.bus);
  }

  /** Install decoded one-shot samples (any subset). Safe to call at any time, repeatedly. */
  setSamples(set: DrumSampleSet): void {
    for (const name of Object.keys(set) as DrumSampleName[]) {
      const buf = set[name];
      if (!buf || this.samples[name]) continue;
      const gain = new Tone.Gain(1).connect(this.bus);
      const player = new Tone.Player(new Tone.ToneAudioBuffer(buf)).connect(gain);
      this.samples[name] = { player, gain };
      this.applySampleLevel(name, Tone.now(), 0);
    }
  }

  /** Which drum names currently use real samples (diagnostics). */
  getLoadedSamples(): DrumSampleName[] {
    return Object.keys(this.samples) as DrumSampleName[];
  }

  private presetDbFor(name: DrumSampleName, p: DrumPreset): number {
    switch (name) {
      case 'kick':
        return p.kickDb;
      case 'snare':
        return p.snareDb;
      case 'clap':
        return p.clapDb;
      case 'hat':
        return p.hatDb;
      case 'openhat':
        return p.openHatDb;
    }
  }

  private applySampleLevel(name: DrumSampleName, time: number, ramp: number): void {
    const s = this.samples[name];
    if (!s) return;
    rampParam(s.player.volume, this.presetDbFor(name, this.preset) + SAMPLE_OFFSET_DB[name], time, ramp);
  }

  private playSample(name: DrumSampleName, time: number, vel: number): boolean {
    const s = this.samples[name];
    if (!s) return false;
    s.gain.gain.setValueAtTime(0.3 + 0.7 * vel, time);
    s.player.start(time);
    return true;
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const v = Math.max(0.05, Math.min(1, 0.25 + 0.75 * vel));
    this.busyUntil = Math.max(this.busyUntil, time + 0.5);
    switch (midi) {
      case DRUM.kick:
        if (!this.playSample('kick', time, vel)) this.kick.triggerAttackRelease(p.kickHz, p.kickDecay + 0.05, time, v);
        break;
      case DRUM.snare:
        if (!this.playSample('snare', time, vel)) {
          this.snareNoise.triggerAttackRelease(p.snareNoiseDecay + 0.02, time, v);
          this.snareBody.triggerAttackRelease(p.snareBodyHz, 0.1, time, v);
        }
        // gated-reverb feel (also on top of a sampled snare, quietly)
        this.snareTail.triggerAttackRelease(p.snareTailGate, time + 0.004, v);
        break;
      case DRUM.clap:
        if (!this.playSample('clap', time, vel)) {
          for (let i = 0; i < 3; i++) this.clap.triggerAttackRelease(0.012, time + i * 0.011, v * (0.55 + 0.15 * i));
          this.clap.triggerAttackRelease(0.12, time + 0.033, v);
        }
        break;
      case DRUM.hatClosed:
        this.openHat.triggerRelease(time); // choke
        if (!this.playSample('hat', time, vel)) this.hat.triggerAttackRelease(p.hatDecay, time, v);
        break;
      case DRUM.hatOpen:
        if (!this.playSample('openhat', time, vel)) this.openHat.triggerAttackRelease(p.openHatDecay, time, v);
        this.busyUntil = Math.max(this.busyUntil, time + p.openHatDecay + 0.1);
        break;
      case DRUM.crash:
        this.crash.triggerAttackRelease(1.6, time, v);
        this.busyUntil = Math.max(this.busyUntil, time + 2);
        break;
      case DRUM.tom:
        this.tom.triggerAttackRelease(midiToHz(midi), 0.4, time, v);
        break;
      default:
        break;
    }
    void durSeconds;
  }

  automate(_param: InstrumentParam, _value01: number, _time: number, _rampSeconds = 0): void {
    // drums have no filter/noise automation target ('filter.drums' does not exist in the contract)
  }

  setPreset(mood: MoodId, rampSeconds: number, _resetAutomation = false): void {
    const p = getPreset(mood).drums;
    this.preset = p;
    const now = Tone.now();
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    rampParam(this.ceiling.frequency, safeCutoff(p.ceilingHz), now, rampSeconds);
    rampParam(this.kick.volume, p.kickDb, now, rampSeconds);
    rampParam(this.snareNoise.volume, p.snareDb, now, rampSeconds);
    rampParam(this.snareBody.volume, p.snareDb - 5, now, rampSeconds);
    rampParam(this.snareTail.volume, p.snareTailDb, now, rampSeconds);
    rampParam(this.clap.volume, p.clapDb, now, rampSeconds);
    rampParam(this.hat.volume, p.hatDb, now, rampSeconds);
    rampParam(this.openHat.volume, p.openHatDb, now, rampSeconds);
    rampParam(this.crash.volume, p.crashDb, now, rampSeconds);
    rampParam(this.tom.volume, p.tomDb, now, rampSeconds);
    rampParam(this.hatHp.frequency, safeCutoff(p.hatHpHz), now, rampSeconds);
    rampParam(this.openHp.frequency, safeCutoff(p.hatHpHz), now, rampSeconds);
    // per-hit shape parameters: applied directly, they only influence the next hit
    this.kick.octaves = p.kickPitchOct;
    this.kick.pitchDecay = p.kickPitchDecay;
    this.kick.envelope.decay = p.kickDecay;
    this.snareNoise.envelope.decay = p.snareNoiseDecay;
    this.hat.envelope.decay = p.hatDecay;
    this.openHat.envelope.decay = p.openHatDecay;
    (Object.keys(this.samples) as DrumSampleName[]).forEach((n) => this.applySampleLevel(n, now, rampSeconds));
  }

  releaseAll(time = Tone.now()): void {
    this.snareTail.triggerRelease(time);
    this.openHat.triggerRelease(time);
    this.crash.triggerRelease(time);
    this.clap.triggerRelease(time);
    this.kick.triggerRelease(time);
    this.tom.triggerRelease(time);
    for (const s of Object.values(this.samples)) s?.player.stop(time);
    this.busyUntil = Math.min(this.busyUntil, time);
  }

  getActiveVoices(): number {
    return this.busyUntil > Tone.now() ? 1 : 0;
  }

  dispose(): void {
    this.kick.dispose();
    this.snareNoise.dispose();
    this.snareBody.dispose();
    this.snareTail.dispose();
    this.clap.dispose();
    this.hat.dispose();
    this.openHat.dispose();
    this.crash.dispose();
    this.tom.dispose();
    for (const f of this.filters) f.dispose();
    for (const s of Object.values(this.samples)) {
      s?.player.dispose();
      s?.gain.dispose();
    }
    this.bus.dispose();
    this.ceiling.dispose();
    this.output.dispose();
  }
}
