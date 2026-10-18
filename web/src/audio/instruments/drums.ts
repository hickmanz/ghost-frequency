import * as Tone from 'tone';
import { DRUM, DRUM_KIT_IDS, type DrumKitId, type MoodId } from '@shared/index';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';
import { dbToGain, drumSaturationMix, midiToHz, safeCutoff, saturationCurve } from '../mapping';
import { drumPresetFor, type DrumPreset } from '../presets';

/** Fixed curve of the parallel shaper; the kit drive sets how much of it is blended in. */
const SHAPER_DRIVE = 2.5;

const SIZZLE_HP_HZ = 6200;
/** Sizzle low-pass: well above the bus ceiling so the hiss survives, but a dark kit/mood still darkens it. */
const sizzleCeiling = (ceilingHz: number): number => Math.min(14000, Math.max(SIZZLE_HP_HZ * 1.4, ceilingHz * 1.6));

/** GM tom notes the drum layer uses for runs (41 low floor .. 50 high). */
const TOM_LO = 41;
const TOM_HI = 50;

/**
 * Synthesized 80s drum machine. Each song picks a kit (linn, dmx, tr808, tr909, simmons, tape, soft) plus a tuning;
 * the kit reshapes every voice on top of the mood preset, and the user's Sound Lab drum settings still win.
 *  - kick: MembraneSynth pitch drop + a short beater click
 *  - snare: filtered noise + pitched body + gated-noise "reverb" tail
 *  - clap: rapid noise bursts + short tail; rim: short triangle ping + click
 *  - hats / ride / crash: inharmonic metal partials through a high-pass; shaker: band-passed noise
 *  - toms: tuned by midi note
 * Bus: clean + parallel saturation -> glue compressor -> low "ceiling" filter.
 */
export class DrumsInstrument implements Instrument {
  readonly layer = 'drums' as const;
  readonly output: Tone.Gain;

  private readonly bus: Tone.Gain;
  private readonly shaper: Tone.WaveShaper;
  private readonly dry: Tone.Gain;
  private readonly wet: Tone.Gain;
  private readonly glue: Tone.Compressor;
  private readonly ceiling: Tone.Filter;

  private readonly kick: Tone.MembraneSynth;
  private readonly kickClick: Tone.NoiseSynth;
  private readonly snareNoise: Tone.NoiseSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly snareTail: Tone.NoiseSynth;
  private readonly snareTailLp: Tone.Filter;
  private readonly snareSizzle: Tone.NoiseSynth;
  private readonly sizzleLp: Tone.Filter;
  private readonly clap: Tone.NoiseSynth;
  private readonly rim: Tone.MembraneSynth;
  private readonly rimClick: Tone.NoiseSynth;
  private readonly hat: Tone.MetalSynth;
  private readonly openHat: Tone.MetalSynth;
  private readonly ride: Tone.MetalSynth;
  private readonly shaker: Tone.NoiseSynth;
  private readonly crash: Tone.MetalSynth;
  private readonly tom: Tone.MembraneSynth;
  private readonly filters: Tone.Filter[] = [];
  private readonly hatHp: Tone.Filter;
  private readonly openHp: Tone.Filter;

  private mood: MoodId;
  private kit: DrumKitId | null = null;
  /** song tuning in semitones */
  private tune = 0;
  private preset: DrumPreset;
  private busyUntil = 0;

  constructor(mood: MoodId) {
    this.mood = mood;
    const p = drumPresetFor(mood, null);
    this.preset = p;

    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.glue = new Tone.Compressor({ threshold: -22, ratio: 2.8, attack: 0.008, release: 0.12, knee: 6 });
    this.ceiling = new Tone.Filter({ type: 'lowpass', frequency: p.ceilingHz, Q: 0.4, rolloff: -24 });
    this.bus = new Tone.Gain(1);
    // parallel saturation: clean path + a shaped copy blended in by the kit drive
    const mix = drumSaturationMix(p.drive);
    this.dry = new Tone.Gain(mix.dry);
    this.wet = new Tone.Gain(mix.wet);
    this.shaper = new Tone.WaveShaper(saturationCurve(SHAPER_DRIVE), 2048);
    this.shaper.oversample = '4x';
    this.bus.connect(this.dry);
    this.bus.chain(this.shaper, this.wet);
    this.dry.connect(this.glue);
    this.wet.connect(this.glue);
    this.glue.chain(this.ceiling, this.output);

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
    this.kickClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.01 },
      volume: p.kickDb + p.kickClickDb,
    }).chain(mkFilter('highpass', 1800, 0.6), mkFilter('lowpass', 4500, 0.5), this.bus);

    // snare = noise + body + gated tail
    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: p.snareNoise },
      envelope: { attack: 0.002, decay: p.snareNoiseDecay, sustain: 0, release: 0.08 },
      volume: p.snareDb,
    }).chain(mkFilter('highpass', 900), mkFilter('lowpass', 5200, 0.5), this.bus);
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 0.65,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.08 },
      volume: p.snareDb + p.snareBodyDb,
    }).connect(this.bus);
    this.snareTailLp = mkFilter('lowpass', p.snareTailHz, 0.5);
    this.snareTail = new Tone.NoiseSynth({
      noise: { type: p.snareNoise },
      envelope: { attack: 0.012, decay: 0.08, sustain: 0.35, release: 0.12 },
      volume: p.snareTailDb,
    }).chain(mkFilter('highpass', 900, 0.5), this.snareTailLp, this.bus);
    // sizzle: the bright white-noise "tss" of 80s machine snares. Skips saturation + the bus ceiling (which would
    // remove it) and gets its own, higher low-pass that still follows the ceiling.
    this.sizzleLp = mkFilter('lowpass', sizzleCeiling(p.ceilingHz), 0.5);
    this.snareSizzle = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: p.snareSizzleDecay, sustain: 0, release: 0.04 },
      volume: p.snareSizzleDb,
    }).chain(mkFilter('highpass', SIZZLE_HP_HZ, 0.5), this.sizzleLp, this.output);

    // clap
    this.clap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.06 },
      volume: p.clapDb,
    }).chain(mkFilter('bandpass', 1200, 0.55), mkFilter('lowpass', 6000, 0.5), this.bus);

    // rim: short wooden ping + click
    this.rim = new Tone.MembraneSynth({
      pitchDecay: 0.004,
      octaves: 1,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.02 },
      volume: p.rimDb,
    }).chain(mkFilter('highpass', 300), this.bus);
    this.rimClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.01 },
      volume: p.rimDb - 6,
    }).chain(mkFilter('bandpass', 3200, 1.5), this.bus);

    // hats: inharmonic metal, then the brightness filter
    const metal = (decay: number, volume: number, harmonicity: number): Tone.MetalSynth => {
      const synth = new Tone.MetalSynth({
        harmonicity,
        modulationIndex: 16,
        resonance: 2800,
        octaves: 0.4,
        envelope: { attack: 0.001, decay, sustain: 0, release: 0.02 },
        volume,
      });
      synth.frequency.value = 320;
      return synth;
    };
    this.hatHp = mkFilter('highpass', p.hatHpHz, 0.5);
    this.hat = metal(p.hatDecay, p.hatDb - 6, 14);
    this.hat.chain(this.hatHp, mkFilter('lowpass', 9000, 0.4), this.bus);
    this.openHp = mkFilter('highpass', p.hatHpHz, 0.5);
    this.openHat = metal(p.openHatDecay, p.openHatDb - 6, 8);
    this.openHat.frequency.value = 240;
    this.openHat.chain(this.openHp, mkFilter('lowpass', 8000, 0.4), this.bus);

    // ride: long, bell-ish metal
    this.ride = new Tone.MetalSynth({
      harmonicity: 5.1,
      modulationIndex: 28,
      resonance: 4800,
      octaves: 1.2,
      envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.3 },
      volume: p.rideDb,
    });
    this.ride.frequency.value = 340;
    this.ride.chain(mkFilter('highpass', 2500, 0.5), this.bus);

    // shaker: soft-attack band-passed noise
    this.shaker = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.012, decay: 0.06, sustain: 0, release: 0.03 },
      volume: p.shakerDb,
    }).chain(mkFilter('bandpass', 5200, 1.1), this.bus);

    // crash: a short splash, not a wash of white noise
    this.crash = metal(0.7, p.crashDb - 4, 5);
    this.crash.frequency.value = 180;
    this.crash.octaves = 1.2;
    this.crash.chain(mkFilter('highpass', 2500, 0.5), this.bus);

    // toms
    this.tom = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 1.5,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.1 },
      volume: p.tomDb,
    }).connect(this.bus);
  }

  /** frequency ratio of the song's kit tuning */
  private get ratio(): number {
    return Math.pow(2, this.tune / 12);
  }

  /** Song kit (index into DRUM_KIT_IDS; invalid = mood drums) and tuning in semitones. */
  setKit(kitIndex: number, tune: number, rampSeconds = 0.05): void {
    const id = Number.isInteger(kitIndex) ? (DRUM_KIT_IDS[kitIndex] ?? null) : null;
    const t = Number.isFinite(tune) ? Math.max(-12, Math.min(12, tune)) : 0;
    if (id === this.kit && t === this.tune) return;
    this.kit = id;
    this.tune = t;
    this.setPreset(this.mood, rampSeconds);
  }

  /** Active kit id (null = mood drums) and tuning, for diagnostics. */
  getKit(): { kit: DrumKitId | null; tune: number } {
    return { kit: this.kit, tune: this.tune };
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const k = this.ratio;
    // wide velocity range: ghost notes really are ghosts
    const v = Math.max(0.04, Math.min(1, 0.12 + 0.88 * vel));
    this.busyUntil = Math.max(this.busyUntil, time + 0.5);
    switch (midi) {
      case DRUM.kick:
        this.kick.triggerAttackRelease(p.kickHz * k, p.kickDecay + 0.05, time, v);
        this.kickClick.triggerAttackRelease(0.02, time, v * 0.55);
        break;
      case DRUM.snare:
        this.snareNoise.triggerAttackRelease(p.snareNoiseDecay + 0.03, time, v * 0.92);
        this.snareBody.triggerAttackRelease(p.snareBodyHz * k, 0.14, time, v * 0.85);
        this.snareTail.triggerAttackRelease(p.snareTailGate, time + 0.006, v * 0.55);
        // ghost notes keep less of the sizzle so they stay soft
        this.snareSizzle.triggerAttackRelease(p.snareSizzleDecay + 0.02, time, v * v);
        break;
      case DRUM.clap:
        this.clap.triggerAttackRelease(0.014, time, v * 0.7);
        this.clap.triggerAttackRelease(0.014, time + 0.018, v * 0.85);
        this.clap.triggerAttackRelease(0.1, time + 0.032, v * 0.75);
        break;
      case DRUM.rim:
        this.rim.triggerAttackRelease(820 * k, 0.03, time, v);
        this.rimClick.triggerAttackRelease(0.012, time, v);
        break;
      case DRUM.hatClosed:
        this.openHat.triggerRelease(time); // choke
        this.hat.triggerAttackRelease(p.hatDecay, time, v * 0.85);
        break;
      case DRUM.hatOpen:
        this.openHat.triggerAttackRelease(p.openHatDecay, time, v * 0.8);
        this.busyUntil = Math.max(this.busyUntil, time + p.openHatDecay + 0.1);
        break;
      case DRUM.ride:
        this.ride.triggerAttackRelease(0.9, time, v * 0.8);
        this.busyUntil = Math.max(this.busyUntil, time + 1.2);
        break;
      case DRUM.shaker:
        this.shaker.triggerAttackRelease(0.05, time, v);
        break;
      case DRUM.crash:
        this.crash.triggerAttackRelease(0.7, time, v * 0.7);
        this.busyUntil = Math.max(this.busyUntil, time + 2);
        break;
      default:
        if (midi >= TOM_LO && midi <= TOM_HI) this.tom.triggerAttackRelease(midiToHz(midi) * k, 0.4, time, v);
        break;
    }
    void durSeconds;
  }

  automate(_param: InstrumentParam, _value01: number, _time: number, _rampSeconds = 0): void {
    // drums have no filter/noise automation target ('filter.drums' does not exist in the contract)
  }

  setPreset(mood: MoodId, rampSeconds: number, _resetAutomation = false): void {
    this.mood = mood;
    const p = drumPresetFor(mood, this.kit);
    const prev = this.preset;
    this.preset = p;
    const now = Tone.now();
    const hk = Math.sqrt(this.ratio); // hats follow the tuning at half strength
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    rampParam(this.ceiling.frequency, safeCutoff(p.ceilingHz), now, rampSeconds);
    rampParam(this.kick.volume, p.kickDb, now, rampSeconds);
    rampParam(this.kickClick.volume, p.kickDb + p.kickClickDb, now, rampSeconds);
    rampParam(this.snareNoise.volume, p.snareDb, now, rampSeconds);
    rampParam(this.snareBody.volume, p.snareDb + p.snareBodyDb, now, rampSeconds);
    rampParam(this.snareTail.volume, p.snareTailDb, now, rampSeconds);
    rampParam(this.snareTailLp.frequency, safeCutoff(p.snareTailHz), now, rampSeconds);
    rampParam(this.snareSizzle.volume, p.snareSizzleDb, now, rampSeconds);
    rampParam(this.sizzleLp.frequency, safeCutoff(sizzleCeiling(p.ceilingHz)), now, rampSeconds);
    rampParam(this.clap.volume, p.clapDb, now, rampSeconds);
    rampParam(this.rim.volume, p.rimDb, now, rampSeconds);
    rampParam(this.rimClick.volume, p.rimDb - 6, now, rampSeconds);
    rampParam(this.hat.volume, p.hatDb - 6, now, rampSeconds);
    rampParam(this.openHat.volume, p.openHatDb - 6, now, rampSeconds);
    rampParam(this.ride.volume, p.rideDb, now, rampSeconds);
    rampParam(this.shaker.volume, p.shakerDb, now, rampSeconds);
    rampParam(this.crash.volume, p.crashDb - 4, now, rampSeconds);
    rampParam(this.tom.volume, p.tomDb, now, rampSeconds);
    rampParam(this.hatHp.frequency, safeCutoff(p.hatHpHz * hk), now, rampSeconds);
    rampParam(this.openHp.frequency, safeCutoff(p.hatHpHz * hk), now, rampSeconds);
    const mix = drumSaturationMix(p.drive);
    rampParam(this.dry.gain, mix.dry, now, rampSeconds);
    rampParam(this.wet.gain, mix.wet, now, rampSeconds);
    // per-hit shape parameters: applied directly, they only influence the next hit
    if (p.snareNoise !== prev.snareNoise) {
      this.snareNoise.noise.type = p.snareNoise;
      this.snareTail.noise.type = p.snareNoise;
    }
    this.snareSizzle.envelope.decay = p.snareSizzleDecay;
    this.kick.octaves = p.kickPitchOct;
    this.kick.pitchDecay = p.kickPitchDecay;
    this.kick.envelope.decay = p.kickDecay;
    this.snareNoise.envelope.decay = p.snareNoiseDecay;
    this.hat.envelope.decay = p.hatDecay;
    this.openHat.envelope.decay = p.openHatDecay;
  }

  releaseAll(time = Tone.now()): void {
    this.snareTail.triggerRelease(time);
    this.openHat.triggerRelease(time);
    this.ride.triggerRelease(time);
    this.crash.triggerRelease(time);
    this.clap.triggerRelease(time);
    this.kick.triggerRelease(time);
    this.tom.triggerRelease(time);
    this.busyUntil = Math.min(this.busyUntil, time);
  }

  getActiveVoices(): number {
    return this.busyUntil > Tone.now() ? 1 : 0;
  }

  dispose(): void {
    for (const n of [
      this.kick, this.kickClick, this.snareNoise, this.snareBody, this.snareTail, this.snareSizzle, this.clap, this.rim, this.rimClick,
      this.hat, this.openHat, this.ride, this.shaker, this.crash, this.tom,
    ]) {
      n.dispose();
    }
    for (const f of this.filters) f.dispose();
    this.bus.dispose();
    this.shaper.dispose();
    this.dry.dispose();
    this.wet.dispose();
    this.glue.dispose();
    this.ceiling.dispose();
    this.output.dispose();
  }
}
