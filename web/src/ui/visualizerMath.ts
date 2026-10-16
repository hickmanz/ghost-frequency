/** Pure helpers for the visualizer (unit-tested). No DOM access. */

export const DB_FLOOR = -100;
export const DB_CEIL = -30;

/** Map a dB value to 0..1. */
export function dbToUnit(db: number, floor = DB_FLOOR, ceil = DB_CEIL): number {
  if (!(db > floor)) return 0; // also handles -Infinity / NaN
  const v = (db - floor) / (ceil - floor);
  return v > 1 ? 1 : v;
}

/** Frame-rate independent attack/decay smoothing toward `target`. */
export function smoothValue(prev: number, target: number, dtMs: number, attackMs: number, decayMs: number): number {
  const tau = target > prev ? attackMs : decayMs;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tau));
  return prev + (target - prev) * k;
}

/**
 * Log-spaced bin ranges. For `bars` bars over a spectrum of `binCount` bins covering 0..sampleRate/2,
 * fills starts[i] (inclusive) / ends[i] (exclusive) so that each bar spans >= 1 bin.
 */
export function buildLogBins(
  binCount: number,
  bars: number,
  starts: Uint16Array,
  ends: Uint16Array,
  sampleRate = 44100,
  minHz = 40,
  maxHz = 16000,
): void {
  const nyquist = sampleRate / 2;
  const lo = Math.max(1, Math.round((binCount * minHz) / nyquist));
  const hi = Math.max(lo + 1, Math.min(binCount, Math.round((binCount * maxHz) / nyquist)));
  const ratio = hi / lo;
  for (let i = 0; i < bars; i++) {
    // Neighbouring low-frequency bars may share a bin (there are fewer bins than bars down there).
    let s = Math.round(lo * Math.pow(ratio, i / bars));
    let e = Math.round(lo * Math.pow(ratio, (i + 1) / bars));
    if (s > binCount - 1) s = binCount - 1;
    if (e <= s) e = s + 1;
    if (e > binCount) e = binCount;
    starts[i] = s;
    ends[i] = e;
  }
}

/** Max dB within [start,end) of the spectrum. */
export function peakDb(spec: Float32Array, start: number, end: number): number {
  let m = -Infinity;
  for (let i = start; i < end; i++) {
    const v = spec[i]!;
    if (v > m) m = v;
  }
  return m;
}
