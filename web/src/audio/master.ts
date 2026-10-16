import * as Tone from 'tone';
import { clamp01, faderToGain, masterFilterHz, saturationCurve } from './mapping';
import { rampParam } from './instruments/instrument';

/** Analyser size: 512 frequency bins (fftSize 1024). */
export const FFT_SIZE = 512;

export interface MasterOptions {
  /** create analysers (skip for offline rendering) */
  analysis?: boolean;
  /** connect to Tone destination (default true) */
  toDestination?: boolean;
}

/**
 * Master chain:
 *   input -> tiny tanh saturation -> 30 Hz low-cut -> +1.5 dB high shelf -> master low-pass ('master.filter')
 *   -> compressor (gentle glue) -> limiter (-1 dB) -> fade gain (reset/pause) -> master volume -> analysers + destination
 *
 * Visualizer data: `getSpectrum()` returns the SAME Float32Array instance on every call (reused to avoid GC);
 * copy it if you need to keep it. Values are dB like AnalyserNode.getFloatFrequencyData.
 */
export class MasterBus {
  readonly input: Tone.Gain;
  readonly output: Tone.Gain; // after master volume

  private readonly saturator: Tone.WaveShaper;
  private readonly lowCut: Tone.Filter;
  private readonly shelf: Tone.Filter;
  private readonly lp: Tone.Filter;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly fade: Tone.Gain;
  private readonly volume: Tone.Gain;

  private readonly mono: Tone.Mono | null = null;
  private readonly fft: Tone.Analyser | null = null;
  private readonly wave: Tone.Analyser | null = null;
  private readonly emptySpectrum = new Float32Array(FFT_SIZE).fill(-140);
  private levelSmoothed = 0;
  private lastLevelTime = 0;

  constructor(opts: MasterOptions = {}) {
    const sr = Tone.getContext().sampleRate;
    this.input = new Tone.Gain(1);
    this.saturator = new Tone.WaveShaper(saturationCurve(0.9), 2048);
    this.saturator.oversample = '2x';
    this.lowCut = new Tone.Filter({ type: 'highpass', frequency: 30, Q: 0.7, rolloff: -12 });
    this.shelf = new Tone.Filter({ type: 'highshelf', frequency: 7500, gain: 1.5 });
    this.lp = new Tone.Filter({ type: 'lowpass', frequency: masterFilterHz(1, sr), Q: 0.5, rolloff: -12 });
    this.compressor = new Tone.Compressor({ threshold: -16, ratio: 2.5, attack: 0.03, release: 0.3, knee: 12 });
    this.limiter = new Tone.Limiter(-1);
    this.fade = new Tone.Gain(1);
    this.volume = new Tone.Gain(faderToGain(0.8));
    this.output = new Tone.Gain(1);

    this.input.chain(
      this.saturator, this.lowCut, this.shelf, this.lp, this.compressor, this.limiter, this.fade, this.volume, this.output,
    );

    if (opts.analysis !== false) {
      this.mono = new Tone.Mono();
      this.fft = new Tone.Analyser({ type: 'fft', size: FFT_SIZE, smoothing: 0.78, channels: 1 });
      this.wave = new Tone.Analyser({ type: 'waveform', size: 512, channels: 1 });
      this.output.connect(this.mono);
      this.mono.connect(this.fft);
      this.mono.connect(this.wave);
    }
    if (opts.toDestination !== false) this.output.toDestination();
  }

  /** User master fader 0..1 */
  setVolume(fader01: number, time = Tone.now(), rampSeconds = 0.05): void {
    rampParam(this.volume.gain, faderToGain(fader01), time, rampSeconds);
  }

  /** Fade gain used for pause/reset (independent of volume). */
  fadeTo(gain01: number, time = Tone.now(), rampSeconds = 0.08): void {
    rampParam(this.fade.gain, clamp01(gain01), time, rampSeconds);
  }

  /** 'master.filter' automation, 0..1, 1 = open */
  setFilter(value01: number, time: number, rampSeconds: number): void {
    const hz = masterFilterHz(value01, Tone.getContext().sampleRate);
    rampParam(this.lp.frequency, hz, time, rampSeconds);
  }

  getSpectrum(): Float32Array {
    if (!this.fft) return this.emptySpectrum;
    return this.fft.getValue() as Float32Array;
  }

  /** Smoothed peak level 0..1 (fast attack, ~250 ms release). */
  getLevel(): number {
    if (!this.wave) return 0;
    const buf = this.wave.getValue() as Float32Array;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]!);
      if (a > peak) peak = a;
    }
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastLevelTime ? Math.min(0.5, (nowMs - this.lastLevelTime) / 1000) : 0.016;
    this.lastLevelTime = nowMs;
    const release = Math.exp(-dt / 0.25);
    this.levelSmoothed = Math.max(peak, this.levelSmoothed * release);
    return clamp01(this.levelSmoothed);
  }

  dispose(): void {
    for (const n of [
      this.input, this.saturator, this.lowCut, this.shelf, this.lp, this.compressor, this.limiter, this.fade,
      this.volume, this.output,
    ]) {
      n.dispose();
    }
    this.mono?.dispose();
    this.fft?.dispose();
    this.wave?.dispose();
  }
}
