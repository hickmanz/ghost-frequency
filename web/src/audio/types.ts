import type { EventBatch, LayerId, MixerParams, MoodId } from '@shared/index';

/**
 * Audio renderer contract. The Tone.js implementation lives in audio/toneRenderer.ts.
 * The renderer owns the audio clock and the beat<->time mapping; nothing outside audio/ imports Tone.
 *
 * Beats are absolute from song start. After reset() the beat clock returns to 0.
 */
export interface AudioRenderer {
  /** Must be called from a user gesture. Resolves when the AudioContext is running. Idempotent. */
  start(): Promise<void>;

  /** Begin / resume the beat clock. */
  play(): void;
  /** Pause the beat clock (scheduled notes stay queued; sustained notes are released smoothly). */
  pause(): void;

  /**
   * Queue a batch of events for playback. May be called while playing; batches are in order.
   * The batch's `tempo` takes effect at batch.startBeat (smooth ramp, no jump).
   * Events whose time has already passed must be dropped silently.
   */
  schedule(batch: EventBatch): void;

  /**
   * Fade out (default ~1.2s), cancel all scheduled events, release voices, reset beat clock to 0,
   * then fade back in. Resolves when ready to receive batches starting at beat 0.
   * Must not leak nodes/events and must not click.
   */
  reset(fadeSeconds?: number): Promise<void>;

  /** Current position in beats of the audio clock (smooth, sub-bar precision). 0 before play. */
  getBeat(): number;
  /** Seconds of audio already scheduled ahead of "now" (for lookahead monitoring). */
  getScheduledAheadBeats(): number;

  /** Swap instrument presets / fx character to the mood. Applied smoothly (crossfade), safe during playback. */
  setMood(mood: MoodId): void;
  /** User mixer, applied immediately with short smoothing. master also sets the master volume. */
  setMixer(mixer: MixerParams): void;
  /** Mute a layer (smooth, click-free). Independent of the user fader and of automation gain. */
  setLayerMuted(layer: LayerId, muted: boolean): void;
  /** Solo one layer (all others silenced smoothly); null clears. Independent of mute/fader/automation. */
  setSolo(layer: LayerId | null): void;
  /**
   * Sound Lab: REPLACE the tuning overrides for `mood` (dotted keys into MoodPreset, see tuning/schema.ts).
   * getPreset(mood) must return the built-in preset merged with these overrides. If `mood` is the active mood,
   * re-apply to all instruments/fx live with a short ramp (~0.1 s) - no node re-creation, no clicks.
   * Safe to call before start() (store and apply later).
   */
  setTuning(mood: MoodId, overrides: Record<string, number>): void;

  /**
   * Sound Lab monitoring. Tap ONE layer's own output (pre solo/mute/fader, so it is visible even when silenced)
   * for the scope/spectrum. Analysers must only exist/process while a layer is selected (null = detach, zero cost).
   */
  setMonitorLayer(layer: LayerId | null): void;
  /** Time-domain samples (-1..1) of the monitored layer: 1024 samples, trigger-aligned at a rising zero crossing when one
   *  exists (stable scope); reuse one typed array (no per-call allocation). Length 0 if no layer is monitored. */
  getMonitorWaveform(): Float32Array;
  /** dB FFT data of the monitored layer: 1024 bins from 0 Hz to Nyquist (floor -140 dB). Length 0 if none. */
  getMonitorSpectrum(): Float32Array;
  /** Smoothed peak level 0..1 for every layer (pre fader), on a -60..0 dB scale (0 = silent, 1 = full scale).
   *  Cheap meters for the layer strip; reuse the returned object. Meters are only active while this is polled. */
  getLayerLevels(): Record<LayerId, number>;

  /** Sample rate (Hz) of the audio context (44100 until start() has created it). For frequency axes. */
  getSampleRate(): number;

  /** Frequency data for visualizer; returns dB values (like AnalyserNode.getFloatFrequencyData) */
  getSpectrum(): Float32Array;
  /** Peak level 0..1 of master output (post-limiter) */
  getLevel(): number;

  dispose(): void;
}
