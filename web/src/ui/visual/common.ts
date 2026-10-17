/** Small pure helpers shared by the canvas visual modes (unit-tested, no DOM access). */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Frame-rate independent exponential approach (rate in 1/ms scaled via tauMs). */
export function approach(prev: number, target: number, dtMs: number, tauMs: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));
  return prev + (target - prev) * k;
}

/** Small fast seeded PRNG (mulberry32). Returns a function producing floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit integer hash of two ints -> float in [0,1). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Tileable 1-D value noise in [0,1]; the pattern repeats every `period` lattice cells. */
export function valueNoise1D(seed: number, x: number, period: number): number {
  const p = Math.max(1, Math.floor(period));
  const i0 = Math.floor(x);
  const f = x - i0;
  const a = hash01(mod(i0, p), seed);
  const b = hash01(mod(i0 + 1, p), seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Tileable fractal noise in [0,1] (octaves double both frequency and period). */
export function fbm1D(seed: number, x: number, period: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let per = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise1D(seed + o * 101, fx, per);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    per *= 2;
  }
  return sum / norm;
}

/**
 * Fill `out` (length N) with a tileable ridge profile in [0,1] spanning `cells` noise cells.
 * `ridged` gives sharper, mountain-like peaks (1-|2n-1|); otherwise smooth rolling hills.
 */
export function fillRidgeTable(out: Float32Array, seed: number, cells: number, ridged: boolean): void {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * cells;
    const v = fbm1D(seed, x, cells, ridged ? 4 : 3);
    out[i] = ridged ? Math.pow(1 - Math.abs(2 * v - 1), 1.35) : v;
  }
}

/** Linear-interpolated, wrap-around sample of a periodic table at fractional index `pos`. */
export function sampleTable(table: Float32Array, pos: number): number {
  const n = table.length;
  const f = Math.floor(pos);
  const t = pos - f;
  const i0 = mod(f, n);
  const i1 = i0 + 1 === n ? 0 : i0 + 1;
  const a = table[i0]!;
  return a + (table[i1]! - a) * t;
}
