/**
 * Pure helpers for the Sound Lab scope (no Tone, no DOM).
 */

/** Number of samples getMonitorWaveform() returns (~23 ms at 44.1 kHz: 2-10 cycles of a typical note). */
export const SCOPE_SAMPLES = 1024;

/** Below this peak the signal is treated as silence: no trigger search, the buffer is copied in raw order. */
const SILENCE_PEAK = 1e-5;
/** The trigger arms once the signal went below -ARM_FRACTION * peak (hysteresis against noise around zero). */
const ARM_FRACTION = 0.1;

/**
 * Copy `dst.length` samples of `src` into `dst`, starting at a RISING ZERO CROSSING when one can be found, so that a
 * periodic signal draws at a stable phase from frame to frame (classic scope trigger).
 *
 * Search: first index `i` (0 <= i <= src.length - dst.length) at which the signal, after having been below
 * -10% of its peak, is >= 0 again. If none is found (silence, DC, noise without a clean crossing, or `src` not longer
 * than `dst`) the first `dst.length` samples are copied in raw order (zero padded when `src` is shorter).
 *
 * Returns the start index used, or -1 for the raw fallback. Allocation free.
 */
export function copyTriggerAligned(src: Float32Array, dst: Float32Array): number {
  const n = dst.length;
  if (n === 0) return -1;
  const maxStart = src.length - n;
  if (maxStart < 0) {
    dst.set(src);
    dst.fill(0, src.length);
    return -1;
  }
  let peak = 0;
  for (let i = 0; i < src.length; i++) {
    const a = Math.abs(src[i]!);
    if (a > peak) peak = a; // NaN never wins
  }
  let start = -1;
  if (peak >= SILENCE_PEAK && Number.isFinite(peak)) {
    const arm = -ARM_FRACTION * peak;
    let armed = false;
    for (let i = 0; i <= maxStart; i++) {
      const v = src[i]!;
      if (!armed) {
        if (v < arm) armed = true;
      } else if (v >= 0) {
        start = i;
        break;
      }
    }
  }
  const from = start < 0 ? 0 : start;
  for (let i = 0; i < n; i++) dst[i] = src[from + i]!;
  return start;
}

/** dB -> 0..1 meter position: `floorDb` (e.g. -60) maps to 0, 0 dBFS to 1. */
export function peakToMeter(peak: number, floorDb = -60): number {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.min(1, Math.max(0, 1 - db / floorDb));
}
