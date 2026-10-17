/** Pure helpers for the scrolling spectrogram (unit-tested). No DOM access. */

/** Displayed frequency range (log axis, low at the bottom). */
export const SPEC_MIN_HZ = 30;
export const SPEC_MAX_HZ = 16000;
/** dB range mapped onto the colour ramp (dBFS-ish analyser output). */
export const SPEC_DB_FLOOR = -95;
export const SPEC_DB_CEIL = -32;
/** Seconds of history visible across the plot. */
export const SPEC_WINDOW_SEC = 24;
export const RAMP_SIZE = 256;

/** Neon colour ramp: black -> indigo -> magenta -> orange -> white (position 0..1, rgb 0..255). */
export const RAMP_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0.0, 2, 1, 10],
  [0.22, 28, 8, 92],
  [0.45, 150, 22, 200],
  [0.62, 255, 43, 160],
  [0.8, 255, 140, 40],
  [1.0, 255, 250, 235],
];

export function unitToColorIndex(unit: number, levels = RAMP_SIZE): number {
  if (!(unit > 0)) return 0;
  if (unit >= 1) return levels - 1;
  return Math.floor(unit * (levels - 1) + 0.5);
}

/** dB -> colour-ramp index 0..levels-1 (non-finite / below floor -> 0). */
export function dbToColorIndex(db: number, floor = SPEC_DB_FLOOR, ceil = SPEC_DB_CEIL, levels = RAMP_SIZE): number {
  if (!(db > floor)) return 0;
  return unitToColorIndex((db - floor) / (ceil - floor), levels);
}

export function isLittleEndian(): boolean {
  return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
}

export function packRgba(r: number, g: number, b: number, littleEndian: boolean): number {
  return littleEndian
    ? (((255 << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | 255) >>> 0);
}

/** Fill `out` (length = ramp size) with packed RGBA pixels interpolated from RAMP_STOPS. */
export function buildColorRamp(out: Uint32Array, littleEndian: boolean): void {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    let k = 0;
    while (k < RAMP_STOPS.length - 2 && t > RAMP_STOPS[k + 1]![0]) k++;
    const s0 = RAMP_STOPS[k]!;
    const s1 = RAMP_STOPS[k + 1]!;
    const span = s1[0] - s0[0];
    const f = span > 0 ? Math.min(1, Math.max(0, (t - s0[0]) / span)) : 0;
    const r = Math.round(s0[1] + (s1[1] - s0[1]) * f);
    const g = Math.round(s0[2] + (s1[2] - s0[2]) * f);
    const b = Math.round(s0[3] + (s1[3] - s0[3]) * f);
    out[i] = packRgba(r, g, b, littleEndian);
  }
}

/** Position 0..1 (0 = minHz, 1 = maxHz) of a frequency on the log axis; clamped. */
export function freqToUnit(hz: number, minHz = SPEC_MIN_HZ, maxHz = SPEC_MAX_HZ): number {
  if (!(hz > minHz)) return 0;
  if (hz >= maxHz) return 1;
  return Math.log(hz / minHz) / Math.log(maxHz / minHz);
}

export function unitToFreq(u: number, minHz = SPEC_MIN_HZ, maxHz = SPEC_MAX_HZ): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return minHz * Math.pow(maxHz / minHz, c);
}

/**
 * Per-row bin mapping for `rows` log-spaced rows (row 0 = lowest frequency).
 * For every row: if the row is narrower than one bin the value is linearly interpolated between bins
 * a[r] and a[r]+1 with weight f[r] (b[r] === a[r]); otherwise it is the max over bins a[r]..b[r] inclusive.
 * `binCount` bins cover 0..sampleRate/2 (bin k centred on k * nyquist / binCount).
 */
export function buildRowMap(
  rows: number,
  binCount: number,
  sampleRate: number,
  a: Uint16Array,
  b: Uint16Array,
  f: Float32Array,
  minHz = SPEC_MIN_HZ,
  maxHz = SPEC_MAX_HZ,
): void {
  const nyq = sampleRate / 2;
  const last = Math.max(0, binCount - 1);
  const binPos = (u: number) => (unitToFreq(u, minHz, maxHz) * binCount) / nyq;
  const denom = Math.max(1, rows - 1);
  for (let r = 0; r < rows; r++) {
    const pc = Math.min(last, binPos(r / denom));
    const plo = binPos(Math.max(0, (r - 0.5) / denom));
    const phi = binPos(Math.min(1, (r + 0.5) / denom));
    if (phi - plo <= 1) {
      const i = Math.min(last, Math.floor(pc));
      a[r] = i;
      b[r] = i;
      f[r] = Math.min(1, Math.max(0, pc - i));
    } else {
      const lo = Math.min(last, Math.max(0, Math.floor(plo + 0.5)));
      const hi = Math.min(last, Math.max(lo, Math.ceil(phi - 0.5)));
      a[r] = lo;
      b[r] = hi;
      f[r] = 0;
    }
  }
}

/** dB value for row r given a row map (see buildRowMap). */
export function sampleRowDb(spec: Float32Array, a: Uint16Array, b: Uint16Array, f: Float32Array, r: number): number {
  const lo = a[r]!;
  const hi = b[r]!;
  if (hi > lo) {
    let m = -Infinity;
    for (let i = lo; i <= hi; i++) {
      const v = spec[i]!;
      if (v > m) m = v;
    }
    return m;
  }
  const v0 = spec[lo]!;
  const nxt = lo + 1 < spec.length ? spec[lo + 1]! : v0;
  const w = f[r]!;
  if (!(v0 > -200) || !(nxt > -200)) return v0 > nxt ? v0 : nxt; // avoid -Infinity math
  return v0 + (nxt - v0) * w;
}

/** Frequencies that get a grid line; `labelled` ones also get a text label. */
export const FREQ_TICKS: readonly { hz: number; label: string | null }[] = [
  { hz: 50, label: null },
  { hz: 100, label: '100' },
  { hz: 200, label: null },
  { hz: 500, label: null },
  { hz: 1000, label: '1k' },
  { hz: 2000, label: null },
  { hz: 5000, label: null },
  { hz: 10000, label: '10k' },
];

/** Level (linear 0..1) -> meter fill 0..1 using a -60..0 dB scale. */
export function levelToMeter(level: number): number {
  if (!(level > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, level));
  const u = (db + 60) / 60;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** Columns / rows for a plot of the given CSS size (bounded to keep ImageData small). */
export function spectrogramGrid(plotW: number, plotH: number): { cols: number; rows: number } {
  const cols = Math.min(640, Math.max(64, Math.floor(plotW / 2)));
  const rows = Math.min(256, Math.max(48, Math.floor(plotH / 1.5)));
  return { cols, rows };
}
