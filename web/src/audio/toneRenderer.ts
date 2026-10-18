import * as Tone from 'tone';
import { DEFAULT_MIXER, type EventBatch, type LayerId, type MixerParams, type MoodId, type ToneParams } from '@shared/index';
import type { AudioRenderer } from './types';
import { AudioGraph } from './graph';
import { Scheduler, type SchedulerHost } from './scheduler';
import { MOOD_RAMP_SECONDS, setSongPalette, setTuningOverrides, splitDrumKit } from './presets';
import { brightToMasterFilter } from './mapping';

const PAUSE_FADE = 0.08;
/** Ramp (s) of live Sound Lab tuning changes: short enough to feel immediate, long enough to be click-free. */
const TUNING_RAMP_SECONDS = 0.1;
/** Coalescing window (ms) for setTuning(): at most one re-apply per ~frame while a slider is dragged. */
const TUNING_COALESCE_MS = 16;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface RendererDebugStats {
  /** Transport events scheduled but not yet fired */
  pendingEvents: number;
  /** voices currently sounding (incl. release tails) summed over all instruments */
  activeVoices: number;
  playing: boolean;
  beat: number;
  aheadBeats: number;
  /** exceptions swallowed inside event callbacks */
  callbackErrors: number;
  /** active song drum kit (null = mood drums) and its tuning in semitones */
  drumKit: string | null;
  drumTune: number;
}

/** Tone's global context is replaced at most once (a second renderer instance must not dispose the first one's). */
let contextConfigured = false;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Tone.js implementation of AudioRenderer.
 *
 * Usage (Conductor): `await start()` (user gesture) -> `setMood()/setMixer()` (any time, also before start) ->
 * `schedule(batch)` for the first batches -> `play()`. After `reset()` the transport is stopped at beat 0:
 * schedule fresh batches from beat 0 then call `play()` again.
 */
export class ToneRenderer implements AudioRenderer {
  private graph: AudioGraph | null = null;
  private scheduler: Scheduler | null = null;
  private startPromise: Promise<void> | null = null;
  private mood: MoodId = 'nostalgic';
  private mixer: MixerParams = { ...DEFAULT_MIXER };
  private readonly muted = new Set<LayerId>();
  private solo: LayerId | null = null;
  private monitorLayer: LayerId | null = null;
  private tuningTimer: ReturnType<typeof setTimeout> | null = null;
  private backlog: EventBatch[] = [];
  private resetChain: Promise<void> = Promise.resolve();
  private disposed = false;

  // ---------------------------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------------------------

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart().catch((err) => {
        this.startPromise = null; // allow retry
        throw err;
      });
    }
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    if (this.disposed) throw new Error('ToneRenderer disposed');
    if (!this.graph && !contextConfigured) {
      contextConfigured = true;
      // A larger buffer + lookahead is much more robust for hours of generative playback than 'interactive'.
      try {
        Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.15 }), true);
      } catch {
        // keep Tone's default context
      }
    }
    await Tone.start();
    if (this.disposed) throw new Error('ToneRenderer disposed');
    if (!this.graph) {
      const graph = new AudioGraph({ mood: this.mood, mixer: this.mixer, muted: this.muted, solo: this.solo });
      this.graph = graph;
      graph.setMonitorLayer(this.monitorLayer);
      const host: SchedulerHost = {
        onNote: (ev, time, dur) => graph.trigger(ev.layer, ev.midi, dur, time, ev.vel),
        onAutomation: (ev, time, ramp) => graph.automate(ev.target, ev.value, time, ramp),
        onTempo: (bpm, time, ramp) => graph.setTempo(bpm, time, ramp),
        onPalette: (ev) => {
          const { kit, tune, rest } = splitDrumKit(ev.overrides);
          if (kit !== undefined) graph.setDrumKit(kit, tune);
          setSongPalette(this.mood, rest);
          graph.retune(TUNING_RAMP_SECONDS);
        },
      };
      this.scheduler = new Scheduler(Tone.getTransport(), host);
    }
    const sched = this.scheduler!;
    for (const b of this.backlog) sched.schedule(b);
    this.backlog = [];
  }

  play(): void {
    const g = this.graph;
    const s = this.scheduler;
    if (!g || !s || this.disposed) return;
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    g.setPlayGate(true, Tone.now(), PAUSE_FADE);
    s.play();
  }

  pause(): void {
    const g = this.graph;
    const s = this.scheduler;
    if (!g || !s || this.disposed || !s.isPlaying()) return;
    s.pause();
    const now = Tone.now();
    g.setPlayGate(false, now, PAUSE_FADE);
    // release sustained notes once the gate is closed (tails of reverb/delay keep ringing)
    g.releaseAll(now + PAUSE_FADE + 0.02);
  }

  schedule(batch: EventBatch): void {
    if (this.disposed) return;
    if (!this.scheduler) {
      this.backlog.push(batch);
      return;
    }
    this.scheduler.schedule(batch);
  }

  cancelFrom(beat: number): void {
    this.scheduler?.cancelFrom(beat);
  }

  seekToBeat(beat: number): void {
    this.scheduler?.seekToBeat(beat);
    const g = this.graph;
    if (g) {
      const t = Tone.now();
      g.releaseAll(t + 0.06);
    }
  }

  applyToneMacros(tone: ToneParams): void {
    const g = this.graph;
    if (!g) return;
    const t = Tone.now();
    g.automate('master.filter', brightToMasterFilter(tone.bright, tone.crush), t, 0.12);
    g.automate('send.reverb', tone.space, t, 0.12);
    g.automate('send.delay', tone.space * 0.85 + tone.wow * 0.08, t, 0.12);
    g.automate('texture.noise', clamp01(tone.grit * 0.55 + tone.crush * 0.45), t, 0.12);
  }

  reset(fadeSeconds = 1.2): Promise<void> {
    // serialise concurrent resets
    this.resetChain = this.resetChain.then(() => this.doReset(fadeSeconds)).catch(() => undefined);
    return this.resetChain;
  }

  private async doReset(fadeSeconds: number): Promise<void> {
    this.backlog = [];
    const g = this.graph;
    const s = this.scheduler;
    if (!g || !s || this.disposed) return;
    const fade = Math.max(0.05, fadeSeconds);

    // 1. fade everything out; stop the delay from regenerating while it drains
    const t0 = Tone.now();
    g.master.fadeTo(0, t0, fade);
    g.fx.setFeedbackEnabled(false, t0, Math.min(0.2, fade));
    await sleep(fade * 1000 + 80);
    if (this.disposed) return;

    // 2. master is silent: cancel everything and rewind
    s.stopAndRewind();
    const t1 = Tone.now();
    // Notes already handed to the audio thread (<= lookahead ahead) may still start; release (quickly) after them.
    g.releaseAll(t1 + 0.25);
    g.fx.setReturnsMuted(true, t1, 0.01);
    g.resetAutomationState();
    g.fx.flushReverb();
    await sleep(380);
    g.setPlayGate(true, Tone.now(), 0.01);
    if (this.disposed) return;

    // 3. restore the sends and fade the master back in
    const t2 = Tone.now();
    g.fx.setFeedbackEnabled(true, t2, 0.05);
    g.fx.setReturnsMuted(false, t2, 0.3);
    g.master.fadeTo(1, t2, 0.3);
  }

  // ---------------------------------------------------------------------------------------------
  // clock
  // ---------------------------------------------------------------------------------------------

  getBeat(): number {
    return this.scheduler ? this.scheduler.getBeat() : 0;
  }

  getScheduledAheadBeats(): number {
    return this.scheduler ? this.scheduler.getScheduledAheadBeats() : 0;
  }

  // ---------------------------------------------------------------------------------------------
  // mood / mixer
  // ---------------------------------------------------------------------------------------------

  setMood(mood: MoodId): void {
    this.mood = mood;
    // the mood crossfade re-applies the (merged) preset anyway; a pending tuning flush must not shorten its ramp
    this.cancelTuningFlush();
    this.graph?.setMood(mood, MOOD_RAMP_SECONDS);
  }

  /**
   * Sound Lab: replace the overrides of `mood`. The merged preset (presets.ts getPreset) is updated immediately; if
   * `mood` is the active mood and the graph exists, the new values are pushed to all instruments + fx with a short
   * ramp. Calls are coalesced (<= one re-apply per ~16 ms) so a 60 Hz slider drag costs one cheap setPreset sweep per
   * frame. Before start() (or for another mood) the overrides are only stored; setMood()/start() pick them up.
   */
  setTuning(mood: MoodId, overrides: Record<string, number>): void {
    if (this.disposed) return;
    setTuningOverrides(mood, overrides);
    if (mood !== this.mood || !this.graph || this.tuningTimer !== null) return;
    this.tuningTimer = setTimeout(() => {
      this.tuningTimer = null;
      if (!this.disposed) this.graph?.retune(TUNING_RAMP_SECONDS);
    }, TUNING_COALESCE_MS);
  }

  private cancelTuningFlush(): void {
    if (this.tuningTimer !== null) clearTimeout(this.tuningTimer);
    this.tuningTimer = null;
  }

  setMixer(mixer: MixerParams): void {
    this.mixer = { ...mixer };
    this.graph?.setMixer(this.mixer);
  }

  setLayerMuted(layer: LayerId, muted: boolean): void {
    if (muted) this.muted.add(layer);
    else this.muted.delete(layer);
    this.graph?.setLayerMuted(layer, muted);
  }

  /**
   * Solo one layer (null clears). Semantics: while a layer is soloed every other layer is silent, and the soloed layer
   * is audible even if it is also muted (solo wins over mute). Applied on a separate gain stage (40 ms ramp) that
   * multiplies with the user fader and the 'layer.gain.<layer>' automation. State survives play/pause/reset().
   */
  setSolo(layer: LayerId | null): void {
    this.solo = layer;
    this.graph?.setSolo(layer);
  }

  // ---------------------------------------------------------------------------------------------
  // Sound Lab monitoring (see MonitorTaps in monitor.ts)
  // ---------------------------------------------------------------------------------------------

  /**
   * Tap ONE layer's instrument output (pre mute/solo/fader) for the lab scope + spectrum; null detaches the analyser.
   * Remembered before start() and re-applied when the graph is created.
   */
  setMonitorLayer(layer: LayerId | null): void {
    this.monitorLayer = layer;
    this.graph?.setMonitorLayer(layer);
  }

  /** 1024 trigger-aligned samples (-1..1) of the monitored layer; reused array; length 0 when nothing is monitored. */
  getMonitorWaveform(): Float32Array {
    return this.graph ? this.graph.getMonitorWaveform() : EMPTY_WAVE;
  }

  /** 1024 dB bins (0 Hz..Nyquist, floor -140) of the monitored layer; reused array; length 0 when nothing is monitored. */
  getMonitorSpectrum(): Float32Array {
    return this.graph ? this.graph.getMonitorSpectrum() : EMPTY_WAVE;
  }

  /** Smoothed pre-fader peak meter 0..1 (-60..0 dB scale) per layer; ONE reused object; meters sleep when not polled. */
  getLayerLevels(): Record<LayerId, number> {
    return this.graph ? this.graph.getLayerLevels() : ZERO_LEVELS;
  }

  /** Sample rate (Hz) of the audio context; 44100 until start() has created it. */
  getSampleRate(): number {
    return this.graph ? Tone.getContext().sampleRate : 44100;
  }

  getComposerLiveParam(key: string): number | undefined {
    return this.graph?.composerLive.getParam(key);
  }

  getComposerFilterOpenness(layer: LayerId): number | undefined {
    return this.graph?.composerLive.getFilter(layer);
  }

  getComposerLiveVersion(): number {
    return this.graph?.composerLive.getVersion() ?? 0;
  }

  // ---------------------------------------------------------------------------------------------
  // visualizer
  // ---------------------------------------------------------------------------------------------

  /**
   * dB values (-Infinity..0 style, typically -100..-20), `fftSize/2` = 512 bins from 0 Hz to Nyquist.
   * The SAME Float32Array instance is returned on every call and overwritten in place (no per-frame allocation);
   * copy it if you need to retain a snapshot.
   */
  getSpectrum(): Float32Array {
    return this.graph ? this.graph.master.getSpectrum() : EMPTY_SPECTRUM;
  }

  /** Smoothed peak level 0..1 of the master output (post-limiter, post master volume). */
  getLevel(): number {
    return this.graph ? this.graph.master.getLevel() : 0;
  }

  // ---------------------------------------------------------------------------------------------
  // diagnostics
  // ---------------------------------------------------------------------------------------------

  getDebugStats(): RendererDebugStats {
    const s = this.scheduler;
    const g = this.graph;
    return {
      pendingEvents: s ? s.pendingCount : this.backlog.reduce((n, b) => n + b.events.length, 0),
      activeVoices: g ? g.getActiveVoices() : 0,
      playing: s ? s.isPlaying() : false,
      beat: this.getBeat(),
      aheadBeats: this.getScheduledAheadBeats(),
      callbackErrors: s ? s.errorCount : 0,
      drumKit: g ? g.instruments.drums.getKit().kit : null,
      drumTune: g ? g.instruments.drums.getKit().tune : 0,
    };
  }

  /** Escape hatch for tooling/tests (not part of the AudioRenderer contract). */
  getGraph(): AudioGraph | null {
    return this.graph;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTuningFlush();
    this.scheduler?.dispose();
    this.graph?.dispose();
    this.scheduler = null;
    this.graph = null;
    this.backlog = [];
  }
}

const EMPTY_SPECTRUM = new Float32Array(512).fill(-140);
const EMPTY_WAVE = new Float32Array(0);
const ZERO_LEVELS: Record<LayerId, number> = { pad: 0, arp: 0, bass: 0, lead: 0, drums: 0, texture: 0, bell: 0 };

export function createRenderer(): AudioRenderer {
  return new ToneRenderer();
}
