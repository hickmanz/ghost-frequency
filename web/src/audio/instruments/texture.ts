import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { FAST_RELEASE, rampParam, VoiceAllocator, type Instrument, type InstrumentParam } from './instrument';
import { dbToGain, logMap, midiToHz, noiseLevelToGain } from '../mapping';
import { oscTrimDb } from '../oscTrim';
import { getBuiltinPreset, getPreset, type TexturePreset, type Wave } from '../presets';

export const DRONE_VOICES = 3;
const DRONE_VOICE_DB = -24;

/**
 * Texture layer:
 *  - continuous filtered pink + brown noise bed (level driven by the 'texture.noise' automation)
 *  - 3 slowly detuned drone voices (very slow attack/release, LFO-modulated low-pass) triggered by 'texture' notes
 * Sound Lab: the drone wave shape is a choice, applied to a drone voice only while it is idle (its next note, or
 * setPreset() on voices idle right now) together with a level trim (oscTrim.ts). The 2 stacked oscillators stay.
 */
export class TextureInstrument implements Instrument {
  readonly layer = 'texture' as const;
  readonly output: Tone.Gain;

  private readonly pink: Tone.Noise;
  private readonly brown: Tone.Noise;
  private readonly pinkGain: Tone.Gain;
  private readonly brownGain: Tone.Gain;
  private readonly noiseFilter: Tone.Filter;
  private readonly noiseHp: Tone.Filter;
  private readonly noiseLevel: Tone.Gain;
  private readonly noiseLfo: Tone.LFO;

  private readonly drones: Tone.Synth[] = [];
  private readonly droneLfos: Tone.LFO[] = [];
  private readonly droneFilter: Tone.Filter;
  private readonly droneFilterLfo: Tone.LFO;
  private readonly droneGain: Tone.Gain;
  private readonly alloc = new VoiceAllocator(DRONE_VOICES);

  private mood: MoodId;
  private preset: TexturePreset;
  private readonly droneWave: Wave[] = [];
  private readonly droneTrim: number[] = [];
  private noiseValue: number;
  private noiseAutomated = false;
  private filterPos: number;
  private droneFilterPos: number;
  private filterAutomated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).texture;
    this.mood = mood;
    this.preset = p;
    this.noiseValue = p.noiseDefault;
    this.filterPos = p.noiseFilterDefault;
    this.droneFilterPos = p.droneFilterDefault;

    this.output = new Tone.Gain(dbToGain(p.levelDb));

    // ---- noise bed
    this.pink = new Tone.Noise('pink');
    this.brown = new Tone.Noise('brown');
    this.pinkGain = new Tone.Gain(dbToGain(p.pinkDb));
    this.brownGain = new Tone.Gain(dbToGain(p.brownDb));
    this.noiseFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: logMap(p.noiseFilterDefault, p.noiseCutoffMin, p.noiseCutoffMax),
      Q: 0.6,
      rolloff: -12,
    });
    this.noiseHp = new Tone.Filter({ type: 'highpass', frequency: 80, rolloff: -12 });
    this.noiseLevel = new Tone.Gain(noiseLevelToGain(p.noiseDefault) * dbToGain(p.noiseScaleDb));
    this.noiseLfo = new Tone.LFO({ frequency: p.noiseLfoRate, min: -1000, max: 1000, units: 'cents' });
    this.noiseLfo.amplitude.value = p.noiseLfoDepthCents / 1000;
    this.noiseLfo.connect(this.noiseFilter.detune);
    this.noiseLfo.start();
    this.pink.connect(this.pinkGain);
    this.brown.connect(this.brownGain);
    this.pinkGain.connect(this.noiseFilter);
    this.brownGain.connect(this.noiseFilter);
    this.noiseFilter.chain(this.noiseHp, this.noiseLevel, this.output);
    this.pink.start();
    this.brown.start();

    // ---- drones
    this.droneFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: logMap(p.droneFilterDefault, p.droneCutoffMin, p.droneCutoffMax),
      Q: p.droneQ,
      rolloff: -24,
    });
    this.droneGain = new Tone.Gain(1);
    this.droneFilterLfo = new Tone.LFO({ frequency: p.droneLfoRate, min: -1000, max: 1000, units: 'cents' });
    this.droneFilterLfo.amplitude.value = p.droneLfoDepthCents / 1000;
    this.droneFilterLfo.connect(this.droneFilter.detune);
    this.droneFilterLfo.start();
    for (let i = 0; i < DRONE_VOICES; i++) {
      const v = new Tone.Synth({
        oscillator: { type: `fat${p.droneBaseType}`, count: 2, spread: p.droneSpread } as Tone.OmniOscillatorOptions,
        envelope: { attack: p.droneAttack, decay: 1, sustain: 1, release: p.droneRelease, attackCurve: 'sine' },
        volume: DRONE_VOICE_DB + p.droneDb + this.trimFor(p.droneBaseType),
      });
      this.droneWave.push(p.droneBaseType);
      this.droneTrim.push(this.trimFor(p.droneBaseType));
      // each voice drifts slowly and differently (+-10 cents)
      const lfo = new Tone.LFO({ frequency: 0.021 + i * 0.013, min: -10, max: 10, units: 'cents', phase: i * 120 });
      lfo.connect(v.detune);
      lfo.start();
      v.connect(this.droneFilter);
      this.drones.push(v);
      this.droneLfos.push(lfo);
    }
    this.droneFilter.chain(this.droneGain, this.output);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const idx = this.alloc.acquire(time);
    const v = this.drones[idx]!;
    // drones need time to bloom
    const dur = Math.max(durSeconds, p.droneAttack * 0.8 + 0.5);
    v.envelope.attack = p.droneAttack;
    v.envelope.release = p.droneRelease;
    if (this.alloc.isFree(idx, time)) this.syncDrone(idx);
    v.triggerAttackRelease(midiToHz(midi), dur, time, 0.4 + 0.6 * vel);
    this.alloc.claim(idx, time + dur + p.droneRelease);
  }

  private trimFor(wave: Wave): number {
    return oscTrimDb('drone', wave, 2, getBuiltinPreset(this.mood).texture.droneBaseType, 2);
  }

  /** Make an IDLE drone voice use the preset's wave shape (+ level trim): a plain property write, no node created. */
  private syncDrone(i: number): void {
    const p = this.preset;
    const trim = this.trimFor(p.droneBaseType);
    if (this.droneWave[i] === p.droneBaseType && this.droneTrim[i] === trim) return;
    const v = this.drones[i]!;
    v.oscillator.baseType = p.droneBaseType;
    rampParam(v.volume, DRONE_VOICE_DB + p.droneDb + trim, Tone.now(), 0);
    this.droneWave[i] = p.droneBaseType;
    this.droneTrim[i] = trim;
  }

  private noiseGainFor(value: number, p: TexturePreset): number {
    return noiseLevelToGain(value) * dbToGain(p.noiseScaleDb);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    const p = this.preset;
    if (param === 'noise') {
      this.noiseAutomated = true;
      this.noiseValue = value01;
      rampParam(this.noiseLevel.gain, this.noiseGainFor(value01, p), time, rampSeconds);
    } else {
      this.filterAutomated = true;
      this.filterPos = value01;
      this.droneFilterPos = value01;
      rampParam(this.noiseFilter.frequency, logMap(value01, p.noiseCutoffMin, p.noiseCutoffMax), time, rampSeconds);
      rampParam(this.droneFilter.frequency, logMap(value01, p.droneCutoffMin, p.droneCutoffMax), time, rampSeconds);
    }
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).texture;
    this.mood = mood;
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) {
      this.noiseAutomated = false;
      this.filterAutomated = false;
    }
    if (!this.noiseAutomated) this.noiseValue = p.noiseDefault;
    if (!this.filterAutomated) {
      this.filterPos = p.noiseFilterDefault;
      this.droneFilterPos = p.droneFilterDefault;
    }
    rampParam(this.noiseLevel.gain, this.noiseGainFor(this.noiseValue, p), now, rampSeconds);
    rampParam(this.pinkGain.gain, dbToGain(p.pinkDb), now, rampSeconds);
    rampParam(this.brownGain.gain, dbToGain(p.brownDb), now, rampSeconds);
    rampParam(this.noiseFilter.frequency, logMap(this.filterPos, p.noiseCutoffMin, p.noiseCutoffMax), now, rampSeconds);
    rampParam(this.noiseLfo.frequency, p.noiseLfoRate, now, rampSeconds);
    rampParam(this.noiseLfo.amplitude, p.noiseLfoDepthCents / 1000, now, rampSeconds);
    rampParam(this.droneFilter.frequency, logMap(this.droneFilterPos, p.droneCutoffMin, p.droneCutoffMax), now, rampSeconds);
    rampParam(this.droneFilter.Q, p.droneQ, now, rampSeconds);
    rampParam(this.droneFilterLfo.frequency, p.droneLfoRate, now, rampSeconds);
    rampParam(this.droneFilterLfo.amplitude, p.droneLfoDepthCents / 1000, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    for (let i = 0; i < this.drones.length; i++) {
      const v = this.drones[i]!;
      v.oscillator.spread = p.droneSpread;
      if (this.alloc.isFree(i, now)) this.syncDrone(i);
      rampParam(v.volume, DRONE_VOICE_DB + p.droneDb + this.droneTrim[i]!, now, rampSeconds);
    }
  }

  releaseAll(time = Tone.now()): void {
    for (const v of this.drones) {
      v.envelope.release = FAST_RELEASE;
      v.triggerRelease(time);
    }
    this.alloc.releaseAll(time, FAST_RELEASE);
  }

  getActiveVoices(): number {
    return this.alloc.active(Tone.now());
  }

  dispose(): void {
    this.pink.dispose();
    this.brown.dispose();
    this.pinkGain.dispose();
    this.brownGain.dispose();
    this.noiseFilter.dispose();
    this.noiseHp.dispose();
    this.noiseLevel.dispose();
    this.noiseLfo.dispose();
    for (const v of this.drones) v.dispose();
    for (const l of this.droneLfos) l.dispose();
    this.droneFilter.dispose();
    this.droneFilterLfo.dispose();
    this.droneGain.dispose();
    this.output.dispose();
  }
}

