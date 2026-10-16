/**
 * Synthetic stereo impulse response generator (pure JS, no Tone / no AudioContext).
 *
 * Why not Tone.Reverb? Tone.Reverb renders a full-bandwidth white-noise IR asynchronously which sounds
 * bright/metallic and cannot be flushed. This generator is synchronous (~10-30 ms for 8 s), deterministic,
 * and gives a warmer tail: high frequencies decay faster than lows (time-varying one-pole low-pass),
 * a soft onset after the pre-delay, and decorrelated L/R channels.
 */

export interface ReverbIROptions {
  sampleRate: number;
  /** RT60-ish decay time in seconds */
  decay: number;
  /** silence before the tail starts, seconds */
  preDelay: number;
  /** low-pass cutoff at the start of the tail (Hz) */
  brightHz?: number;
  /** low-pass cutoff at t = decay (Hz) */
  darkHz?: number;
  seed?: number;
}

/** Tiny deterministic PRNG (mulberry32) so the IR is identical across sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns [left, right] sample arrays. Peak amplitude is bounded (<= ~1); loudness is normalised by the ConvolverNode. */
export function generateReverbIR(opts: ReverbIROptions): [Float32Array, Float32Array] {
  const sr = opts.sampleRate;
  const decay = Math.max(0.2, opts.decay);
  const pre = Math.max(0, opts.preDelay);
  const bright = opts.brightHz ?? 9000;
  const dark = Math.max(300, opts.darkHz ?? 1400);
  const tailSeconds = decay * 1.25;
  const length = Math.max(64, Math.floor((pre + tailSeconds) * sr));
  const preSamples = Math.floor(pre * sr);
  const out: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  const decayRate = 6.907755 / decay; // ln(1000): -60 dB at t = decay
  const onset = 0.018; // soft onset time constant (s)

  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry32((opts.seed ?? 0x9e3779b9) + ch * 7919);
    const data = out[ch]!;
    let lp = 0;
    let lp2 = 0;
    for (let i = preSamples; i < length; i++) {
      const t = (i - preSamples) / sr;
      const noise = rand() * 2 - 1;
      // cutoff glides exponentially from bright -> dark across the decay
      const k = Math.min(1, t / decay);
      const fc = bright * Math.pow(dark / bright, k);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (noise - lp);
      lp2 += a * (lp - lp2); // 2-pole for a softer top end
      const env = Math.exp(-decayRate * t) * (1 - Math.exp(-t / onset));
      data[i] = lp2 * env * 3.0;
    }
    // fade the last 50 ms to avoid any end-of-buffer click
    const fadeLen = Math.min(length, Math.floor(0.05 * sr));
    for (let i = 0; i < fadeLen; i++) {
      const idx = length - 1 - i;
      data[idx] = data[idx]! * (i / fadeLen);
    }
  }
  return out;
}
