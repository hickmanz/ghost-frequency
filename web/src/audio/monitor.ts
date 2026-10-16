import * as Tone from 'tone';
import { LAYER_IDS, type LayerId } from '@shared/index';
import { SCOPE_SAMPLES, copyTriggerAligned, peakToMeter } from './scope';

/** Native analyser size of the scope tap: 2048 time samples (-> 1024-sample aligned window) and 1024 FFT bins. */
const SCOPE_FFT_SIZE = 2048;
/** Native analyser size of the per-layer level meters (1024 samples ~ 23 ms: no peak is missed at 30-60 fps polling). */
const METER_FFT_SIZE = 1024;
/** dB floor of the meter scale (0 = silence, 1 = 0 dBFS). */
const METER_FLOOR_DB = -60;
/** Meter release time constant (s); attack is instant. */
const METER_RELEASE_S = 0.2;
/** Meters are torn down when getLevels() was not called for this long (lab closed): zero cost when unused. */
const METER_IDLE_MS = 1500;
const SPECTRUM_FLOOR_DB = -140;

const EMPTY = new Float32Array(0);

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Sound Lab monitor taps. Everything is lazy and torn down when unused:
 *
 *  - SCOPE TAP: ONE native AnalyserNode (fftSize 2048), created on the first setLayer(layer) and connected ONLY to the
 *    selected layer's instrument output (before the channel strip: auto gain / pause gate / mute+solo / fader), so
 *    the layer is visible even when it is muted or not soloed. setLayer(other) moves the connection, setLayer(null)
 *    disconnects it (nothing is processed any more); the same node is reused for every selection (no node growth).
 *    - getWaveform(): SCOPE_SAMPLES (1024) samples in -1..1, copied from a rising zero crossing when one exists.
 *    - getSpectrum(): 1024 dB bins from 0 Hz to Nyquist (floor -140).
 *    Both return the same reused Float32Array on every call (copy to keep) and a length-0 array when no layer is
 *    monitored.
 *  - LEVEL METERS: one native AnalyserNode (fftSize 1024) per layer, created on the first getLevels() call and
 *    disposed again when getLevels() has not been called for ~1.5 s. getLevels() reads the time-domain peak of each
 *    (6 x 1024 samples), maps it to 0..1 on a -60..0 dB scale (instant attack, ~200 ms release) and returns ONE reused
 *    object.
 *
 * `enabled = false` (offline rendering) makes every method a no-op returning empty / zero data.
 */
export class MonitorTaps {
  private layer: LayerId | null = null;
  private scope: AnalyserNode | null = null;
  private scopeRaw: Float32Array<ArrayBuffer> | null = null;
  private scopeWave: Float32Array<ArrayBuffer> | null = null;
  private scopeSpec: Float32Array<ArrayBuffer> | null = null;

  private meters: Record<LayerId, AnalyserNode> | null = null;
  private meterRaw: Float32Array<ArrayBuffer> | null = null;
  private meterTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLevelsCall = 0;
  private lastLevelsTime = 0;
  private readonly levels = {} as Record<LayerId, number>;
  private disposed = false;

  constructor(
    private readonly outputs: Record<LayerId, Tone.ToneAudioNode>,
    private readonly enabled = true,
  ) {
    for (const l of LAYER_IDS) this.levels[l] = 0;
  }

  getLayer(): LayerId | null {
    return this.layer;
  }

  // -------------------------------------------------------------------------------------------
  // scope tap
  // -------------------------------------------------------------------------------------------

  setLayer(layer: LayerId | null): void {
    if (!this.enabled || this.disposed || layer === this.layer) return;
    if (this.layer !== null && this.scope) this.outputs[this.layer].disconnect(this.scope);
    this.layer = layer;
    if (layer === null) return;
    if (!this.scope) {
      const a = Tone.getContext().rawContext.createAnalyser();
      a.fftSize = SCOPE_FFT_SIZE;
      a.smoothingTimeConstant = 0.7;
      this.scope = a;
      this.scopeRaw = new Float32Array(a.fftSize);
      this.scopeWave = new Float32Array(SCOPE_SAMPLES);
      this.scopeSpec = new Float32Array(a.frequencyBinCount).fill(SPECTRUM_FLOOR_DB);
    }
    this.outputs[layer].connect(this.scope);
  }

  getWaveform(): Float32Array {
    const a = this.scope;
    if (this.layer === null || !a || !this.scopeRaw || !this.scopeWave) return EMPTY;
    a.getFloatTimeDomainData(this.scopeRaw);
    copyTriggerAligned(this.scopeRaw, this.scopeWave);
    return this.scopeWave;
  }

  getSpectrum(): Float32Array {
    const a = this.scope;
    const out = this.scopeSpec;
    if (this.layer === null || !a || !out) return EMPTY;
    a.getFloatFrequencyData(out);
    for (let i = 0; i < out.length; i++) if (!(out[i]! > SPECTRUM_FLOOR_DB)) out[i] = SPECTRUM_FLOOR_DB;
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // level meters
  // -------------------------------------------------------------------------------------------

  getLevels(): Record<LayerId, number> {
    if (!this.enabled || this.disposed) return this.levels;
    const t = nowMs();
    this.lastLevelsCall = t;
    if (!this.meters) this.createMeters();
    const meters = this.meters;
    const raw = this.meterRaw;
    if (!meters || !raw) return this.levels;
    const dt = this.lastLevelsTime ? Math.min(0.5, (t - this.lastLevelsTime) / 1000) : 0.016;
    this.lastLevelsTime = t;
    const release = Math.exp(-dt / METER_RELEASE_S);
    for (const l of LAYER_IDS) {
      meters[l].getFloatTimeDomainData(raw);
      let peak = 0;
      for (let i = 0; i < raw.length; i++) {
        const a = Math.abs(raw[i]!);
        if (a > peak) peak = a;
      }
      const v = peakToMeter(peak, METER_FLOOR_DB);
      this.levels[l] = Math.max(v, this.levels[l] * release);
    }
    return this.levels;
  }

  private createMeters(): void {
    const ctx = Tone.getContext().rawContext;
    const meters = {} as Record<LayerId, AnalyserNode>;
    for (const l of LAYER_IDS) {
      const a = ctx.createAnalyser();
      a.fftSize = METER_FFT_SIZE;
      a.smoothingTimeConstant = 0;
      this.outputs[l].connect(a);
      meters[l] = a;
    }
    this.meters = meters;
    this.meterRaw = new Float32Array(METER_FFT_SIZE);
    this.lastLevelsTime = 0;
    for (const l of LAYER_IDS) this.levels[l] = 0;
    this.armMeterWatchdog();
  }

  private armMeterWatchdog(): void {
    if (this.meterTimer !== null) return;
    this.meterTimer = setTimeout(() => {
      this.meterTimer = null;
      if (this.disposed || !this.meters) return;
      if (nowMs() - this.lastLevelsCall >= METER_IDLE_MS) this.destroyMeters();
      else this.armMeterWatchdog();
    }, METER_IDLE_MS);
  }

  /** True while the per-layer meters exist (diagnostics / tests). */
  hasMeters(): boolean {
    return this.meters !== null;
  }

  private destroyMeters(): void {
    const meters = this.meters;
    this.meters = null;
    this.meterRaw = null;
    if (this.meterTimer !== null) clearTimeout(this.meterTimer);
    this.meterTimer = null;
    if (!meters) return;
    for (const l of LAYER_IDS) {
      try {
        this.outputs[l].disconnect(meters[l]);
      } catch {
        // already disconnected
      }
      meters[l].disconnect();
    }
    for (const l of LAYER_IDS) this.levels[l] = 0;
  }

  // -------------------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyMeters();
    if (this.scope) {
      if (this.layer !== null) {
        try {
          this.outputs[this.layer].disconnect(this.scope);
        } catch {
          // already disconnected
        }
      }
      this.scope.disconnect();
    }
    this.layer = null;
    this.scope = null;
    this.scopeRaw = null;
    this.scopeWave = null;
    this.scopeSpec = null;
  }
}
