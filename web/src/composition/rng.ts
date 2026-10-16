/**
 * Seeded, deterministic randomness. No Math.random anywhere in composition code.
 *
 * `stream(seed, ...keys)` derives an independent PRNG from a seed and any number of string/number keys,
 * so every (section, layer, bar, ...) can own its own stream: changing how many random numbers one layer
 * consumes never reshuffles another layer or the chord progression.
 */

export interface Rng {
  /** uniform float in [0, 1) */
  next(): number;
}

/** mulberry32 PRNG */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function mixWord(h: number, x: number): number {
  h = Math.imul(h ^ (x & 0xff), 0x01000193);
  h = Math.imul(h ^ ((x >>> 8) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((x >>> 16) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((x >>> 24) & 0xff), 0x01000193);
  return h >>> 0;
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash a seed plus keys to a uint32. */
export function hashKeys(seed: number, keys: ReadonlyArray<string | number>): number {
  let h = mixWord(0x811c9dc5, seed >>> 0);
  for (const key of keys) {
    if (typeof key === 'number') {
      h = mixWord(h, 0x9e3779b1);
      // integer keys hash exactly; fractional keys keep 1e-3 precision
      const n = Number.isInteger(key) ? key : Math.round(key * 1000) + 0x5bd1e995;
      h = mixWord(h, n | 0);
    } else {
      h = mixWord(h, 0x7f4a7c15);
      for (let i = 0; i < key.length; i++) h = mixWord(h, key.charCodeAt(i));
    }
  }
  return fmix32(h);
}

/** Derive an independent stream from a seed and keys, e.g. stream(seed, 'arp', sectionIndex, bar). */
export function stream(seed: number, ...keys: Array<string | number>): Rng {
  const r = mulberry32(hashKeys(seed, keys));
  // warm-up so near-identical keys decorrelate
  r.next();
  r.next();
  return r;
}

/** Uniform float in [lo, hi). */
export function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng.next();
}

/** Uniform integer in [lo, hi] inclusive. */
export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng.next() * (hi - lo + 1));
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

/** Uniformly pick an element. Throws on empty arrays. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty array');
  return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))]!;
}

export type Weighted<T> = readonly [item: T, weight: number];

/** Pick by non-negative weights. If every weight is 0 the first item wins. */
export function weightedPick<T>(rng: Rng, items: ReadonlyArray<Weighted<T>>): T {
  if (items.length === 0) throw new Error('weightedPick: empty array');
  let total = 0;
  for (const it of items) total += Math.max(0, it[1]);
  if (total <= 0) return items[0]![0];
  let r = rng.next() * total;
  for (const it of items) {
    r -= Math.max(0, it[1]);
    if (r < 0) return it[0];
  }
  return items[items.length - 1]![0];
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** Symmetric small random offset in [-amount, amount]. */
export function jitter(rng: Rng, amount: number): number {
  return (rng.next() * 2 - 1) * amount;
}
