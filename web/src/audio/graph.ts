import * as Tone from 'tone';
import { LAYER_IDS, type AutomationTarget, type LayerId, type MixerParams, type MoodId } from '@shared/index';
import { FxBus } from './fx';
import { allInstruments, createInstruments, type InstrumentSet } from './instruments';
import { MasterBus } from './master';
import { SEND_NEUTRAL, parseTarget, sendMultiplier } from './mapping';
import { ChannelStrip } from './mixer';
import { MonitorTaps } from './monitor';
import { MOOD_RAMP_SECONDS, getPreset } from './presets';
import type { DrumSampleSet } from './samples';

export interface GraphOptions {
  mood: MoodId;
  mixer: MixerParams;
  /** create FFT/level analysers (false for offline rendering) */
  analysis?: boolean;
  /** connect the master to Tone's destination of the CURRENT context (default true) */
  toDestination?: boolean;
  /** initial Sound Lab mute / solo state */
  muted?: Iterable<LayerId>;
  solo?: LayerId | null;
}

/** Ramp (s) for mute/solo changes: fast enough to feel instant, slow enough to be click-free. */
const MONITOR_RAMP_SECONDS = 0.04;

/**
 * The complete audio graph: instruments -> channel strips -> (dry master input | fx sends) -> master chain.
 *
 * It has no global-context assumptions: everything is created against `Tone.getContext()` at construction time, so it
 * can be built inside a `Tone.Offline` callback as well as on the realtime context.
 */
export class AudioGraph {
  readonly instruments: InstrumentSet;
  readonly strips: Record<LayerId, ChannelStrip>;
  readonly fx: FxBus;
  readonly master: MasterBus;
  /** Sound Lab scope / spectrum / level taps (lazy; inert when analysis is false) */
  readonly taps: MonitorTaps;

  private mood: MoodId;
  private readonly muted = new Set<LayerId>();
  private solo: LayerId | null = null;
  private reverbMul = SEND_NEUTRAL;
  private delayMul = SEND_NEUTRAL;
  private disposed = false;

  constructor(opts: GraphOptions) {
    this.mood = opts.mood;
    this.master = new MasterBus({ analysis: opts.analysis, toDestination: opts.toDestination });
    this.fx = new FxBus(opts.mood);
    this.fx.output.connect(this.master.input);
    this.instruments = createInstruments(opts.mood);

    const strips = {} as Record<LayerId, ChannelStrip>;
    const outputs = {} as Record<LayerId, Tone.ToneAudioNode>;
    for (const inst of allInstruments(this.instruments)) {
      strips[inst.layer] = new ChannelStrip(inst.layer, inst, this.master.input, this.fx.reverbIn, this.fx.delayIn);
      outputs[inst.layer] = inst.output;
    }
    this.strips = strips;
    this.taps = new MonitorTaps(outputs, opts.analysis !== false);

    this.setMixer(opts.mixer, true); // immediate: no initial ramp from the default faders
    this.applySends(Tone.now(), 0);
    for (const l of opts.muted ?? []) this.muted.add(l);
    this.solo = opts.solo ?? null;
    for (const l of LAYER_IDS) {
      this.strips[l].setAudible(this.solo === null ? !this.muted.has(l) : l === this.solo, Tone.now(), 0);
    }
  }

  // -------------------------------------------------------------------------------------------
  // mixer / mood
  // -------------------------------------------------------------------------------------------

  setMixer(mixer: MixerParams, immediate = false): void {
    const now = Tone.now();
    const ramp = immediate ? 0 : 0.05;
    for (const l of LAYER_IDS) this.strips[l].setFader(mixer[l] ?? 0.7, now, ramp);
    this.master.setVolume(mixer.master ?? 0.8, now, ramp);
  }

  /**
   * Mute / solo semantics (Sound Lab): a layer is audible iff
   *   solo === null ? !muted : layer === solo
   * i.e. while a layer is soloed, every other layer is silent (even if unmuted) and the soloed layer is audible even
   * if it is also muted (solo wins over mute). Clearing solo restores the plain mute states.
   */
  setLayerMuted(layer: LayerId, muted: boolean): void {
    if (muted) this.muted.add(layer);
    else this.muted.delete(layer);
    this.applyMonitor();
  }

  setSolo(layer: LayerId | null): void {
    this.solo = layer;
    this.applyMonitor();
  }

  private applyMonitor(): void {
    const now = Tone.now();
    for (const l of LAYER_IDS) {
      const audible = this.solo === null ? !this.muted.has(l) : l === this.solo;
      this.strips[l].setAudible(audible, now, MONITOR_RAMP_SECONDS);
    }
  }

  getMood(): MoodId {
    return this.mood;
  }

  setMood(mood: MoodId, rampSeconds = MOOD_RAMP_SECONDS): void {
    this.mood = mood;
    this.applyPreset(rampSeconds, true);
  }

  /**
   * Re-apply the CURRENT mood's (merged) preset to all instruments + fx with a short ramp. Used by Sound Lab live
   * tuning. No node creation; automation state (filter positions, send multipliers) is preserved.
   */
  retune(rampSeconds = 0.1): void {
    this.applyPreset(rampSeconds, false);
  }

  private applyPreset(rampSeconds: number, glideDelayTime: boolean): void {
    const mood = this.mood;
    for (const inst of allInstruments(this.instruments)) inst.setPreset(mood, rampSeconds);
    this.fx.setMood(mood, rampSeconds, glideDelayTime);
    this.applySends(Tone.now(), rampSeconds);
  }

  private applySends(time: number, rampSeconds: number): void {
    const fx = getPreset(this.mood).fx;
    for (const l of LAYER_IDS) {
      this.strips[l].setSends(fx.reverbSend[l] * this.reverbMul, fx.delaySend[l] * this.delayMul, time, rampSeconds);
    }
  }

  // -------------------------------------------------------------------------------------------
  // events
  // -------------------------------------------------------------------------------------------

  trigger(layer: LayerId, midi: number, durSeconds: number, time: number, vel: number): void {
    this.instruments[layer]?.trigger(midi, durSeconds, time, vel);
  }

  /** Apply a normalized automation value at audio `time` with a ramp (seconds). */
  automate(target: AutomationTarget, value01: number, time: number, rampSeconds: number): void {
    const t = parseTarget(target);
    switch (t.kind) {
      case 'filter':
        this.instruments[t.layer].automate('filter', value01, time, rampSeconds);
        break;
      case 'layerGain':
        this.strips[t.layer].setAutomationGain(value01, time, rampSeconds);
        break;
      case 'sendReverb':
        this.reverbMul = sendMultiplier(value01);
        this.applySends(time, rampSeconds);
        break;
      case 'sendDelay':
        this.delayMul = sendMultiplier(value01);
        this.applySends(time, rampSeconds);
        break;
      case 'textureNoise':
        this.instruments.texture.automate('noise', value01, time, rampSeconds);
        break;
      case 'masterFilter':
        this.master.setFilter(value01, time, rampSeconds);
        break;
      default:
        break;
    }
  }

  setTempo(bpm: number, time: number, rampSeconds: number): void {
    this.fx.setTempo(bpm, time, Math.max(0.3, rampSeconds));
  }

  /** Pause gate: closes/opens every strip (sends included) so tails of reverb/delay keep ringing naturally. */
  setPlayGate(open: boolean, time = Tone.now(), rampSeconds = 0.08): void {
    for (const l of LAYER_IDS) this.strips[l].setGate(open, time, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    for (const inst of allInstruments(this.instruments)) inst.releaseAll(time);
  }

  setDrumSamples(set: DrumSampleSet): void {
    if (!this.disposed) this.instruments.drums.setSamples(set);
  }

  /** Sound Lab: monitor ONE layer's own instrument output (pre channel strip). null = detach. */
  setMonitorLayer(layer: LayerId | null): void {
    if (!this.disposed) this.taps.setLayer(layer);
  }

  getMonitorLayer(): LayerId | null {
    return this.taps.getLayer();
  }

  getMonitorWaveform(): Float32Array {
    return this.taps.getWaveform();
  }

  getMonitorSpectrum(): Float32Array {
    return this.taps.getSpectrum();
  }

  getLayerLevels(): Record<LayerId, number> {
    return this.taps.getLevels();
  }

  getActiveVoices(): number {
    let n = 0;
    for (const inst of allInstruments(this.instruments)) n += inst.getActiveVoices();
    return n;
  }

  /**
   * Return all automation-controlled state to neutral (call while the master is silent): filters/noise to preset
   * defaults, send multipliers neutral, layer automation gains 1, master filter open.
   */
  resetAutomationState(): void {
    const now = Tone.now();
    this.reverbMul = SEND_NEUTRAL;
    this.delayMul = SEND_NEUTRAL;
    for (const inst of allInstruments(this.instruments)) inst.setPreset(this.mood, 0.05, true);
    this.fx.setMood(this.mood, 0.05);
    this.applySends(now, 0.05);
    for (const l of LAYER_IDS) this.strips[l].resetAutomation(now);
    this.master.setFilter(1, now, 0.05);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.taps.dispose();
    for (const l of LAYER_IDS) this.strips[l].dispose();
    for (const inst of allInstruments(this.instruments)) inst.dispose();
    this.fx.dispose();
    this.master.dispose();
  }
}
