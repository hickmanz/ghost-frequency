/**
 * Harmony: progression generation (weighted grammar per mood), mutation, related keys / pivot chords,
 * pad voice leading and bass-root placement. Pure, deterministic (seeded streams only).
 */
import type { KeySpec, ScaleName } from '@shared/index';
import {
  BORROWED,
  BORROW_OPTIONS_MAJORISH,
  BORROW_OPTIONS_MINORISH,
  GRAMMARS,
  type MoodConfig,
  type ProgToken,
} from './moods';
import { chance, shuffle, weightedPick, type Rng } from './rng';
import {
  SCALE_INTERVALS,
  SCALE_MODE_OFFSET,
  buildChord,
  isMinorish,
  keysEqual,
  mod12,
  scalePcs,
  type ChordColor,
  type ChordTemplate,
  type RealChord,
} from './theory';

export interface Progression {
  key: KeySpec;
  chords: RealChord[];
  /** total bars of one pass through the chord list */
  loopBars: number;
}

export function progressionBars(chords: readonly { bars: number }[]): number {
  return chords.reduce((s, c) => s + c.bars, 0);
}

/** Re-realise chord templates in a (possibly different) key. */
export function realizeProgression(key: KeySpec, templates: readonly ChordTemplate[]): Progression {
  const chords = templates.map((t) => buildChord(key, t));
  return { key, chords, loopBars: progressionBars(chords) };
}

export function templatesOf(prog: Progression): ChordTemplate[] {
  return prog.chords.map((c) => ({ ...c.template }));
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function rootOffsetOf(key: KeySpec, tpl: ChordTemplate): number {
  if (tpl.degree !== undefined) return SCALE_INTERVALS[key.scale][((tpl.degree % 7) + 7) % 7]!;
  return mod12(tpl.offset ?? 0);
}

function isTritone(a: number, b: number): boolean {
  return mod12(a - b) === 6;
}

function isDimChord(key: KeySpec, tpl: ChordTemplate): boolean {
  return buildChord(key, { ...tpl, color: 'triad' }).intervals[2] === 6;
}

function tokenToTemplate(tok: ProgToken, color: ChordColor, bars: number): ChordTemplate {
  if (typeof tok === 'number') return { degree: tok, color, bars };
  const b = BORROWED[tok];
  return { offset: b.offset, quality: b.quality, color, bars };
}

function colorFor(
  rng: Rng,
  mood: MoodConfig,
  tpl: ChordTemplate,
  isTonic: boolean,
): ChordColor {
  const table = isTonic ? mood.tonicColors : mood.colors;
  const color = weightedPick(rng, table);
  if (tpl.degree === undefined) {
    // borrowed chords: keep colours simple
    if (color === 'quartal' || color === 'sus4') return 'triad';
    if (color === 'ninth') return 'add9';
  }
  return color;
}

// ---------------------------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------------------------

function markovTokens(key: KeySpec, n: number, rng: Rng): number[] {
  const g = GRAMMARS[key.scale];
  const degs = [0, 1, 2, 3, 4, 5, 6];
  const rootOf = (d: number): number => SCALE_INTERVALS[key.scale][d]!;
  const out: number[] = [weightedPick(rng, degs.map((d) => [d, g.start[d]!] as const))];
  for (let i = 1; i < n; i++) {
    const prev = out[i - 1]!;
    const last = i === n - 1;
    const weights = degs.map((d) => {
      let w = g.transitions[prev]![d]!;
      if (last) w = (w + 0.25) * g.cadence[d]!;
      if (d === out[0] && last) w = 0; // do not end on the first chord: cadence pulls *back* to it
      if (isTritone(rootOf(d), rootOf(prev))) w = 0;
      if (isDimChord(key, { degree: d, color: 'triad', bars: 1 })) w = 0;
      return [d, w] as const;
    });
    let total = 0;
    for (const w of weights) total += w[1];
    if (total <= 0) {
      // fall back to a safe cadence-ish degree
      const fallback = [6, 4, 3, 5, 0].find((d) => d !== prev && d !== out[0]) ?? 6;
      out.push(fallback);
    } else out.push(weightedPick(rng, weights));
  }
  // cadence into the start must not be a tritone
  if (n > 1 && isTritone(rootOf(out[n - 1]!), rootOf(out[0]!))) out[n - 1] = prevSafe(out, rootOf);
  return out;
}

function prevSafe(out: number[], rootOf: (d: number) => number): number {
  const first = out[0]!;
  for (const d of [6, 4, 3, 5, 2]) if (!isTritone(rootOf(d), rootOf(first)) && d !== first) return d;
  return out[out.length - 1]!;
}

/** Remove equal / tritone-related neighbours (cyclically) by swapping in the best-fitting safe degree. */
function sanitizeTokens(key: KeySpec, tokens: ProgToken[]): ProgToken[] {
  const n = tokens.length;
  const out = tokens.slice();
  const g = GRAMMARS[key.scale];
  const root = (t: ProgToken): number => rootOffsetOf(key, tokenToTemplate(t, 'triad', 1));
  const bad = (a: ProgToken, b: ProgToken): boolean => root(a) === root(b) || isTritone(root(a), root(b));
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!bad(out[i]!, out[j]!)) continue;
      const idx = j === 0 ? i : j;
      const prev = out[(idx - 1 + n) % n]!;
      const next = out[(idx + 1) % n]!;
      let best: ProgToken | null = null;
      let bestW = -1;
      for (let d = 0; d < 7; d++) {
        if (isDimChord(key, { degree: d, color: 'triad', bars: 1 })) continue;
        if (bad(d, prev) || bad(d, next)) continue;
        const w = (typeof prev === 'number' ? g.transitions[prev]![d]! : 1) + 0.1;
        if (w > bestW) {
          bestW = w;
          best = d;
        }
      }
      if (best !== null) out[idx] = best;
    }
  }
  return out;
}
/**
 * Generate a progression for a key + mood. 4-8 chords, loop length 8 or 16 bars. Starts on a stable chord
 * and ends on a chord that pulls back to the start (cadence-ish), so the loop always sounds intentional.
 */
export function generateProgression(key: KeySpec, mood: MoodConfig, rng: Rng): Progression {
  const lengths = weightedPick(rng, mood.chordBars).slice();
  const n = lengths.length;
  let tokens: ProgToken[] | null = null;
  const canonical = mood.canonical[key.scale];
  if (canonical && n === 4 && chance(rng, mood.canonicalChance)) {
    tokens = weightedPick(rng, canonical).slice();
  }
  if (!tokens) tokens = markovTokens(key, n, rng);
  // the tonic must be part of every progression (identity of the key)
  if (!tokens.includes(0)) tokens = [0, ...tokens.slice(1)];
  tokens = sanitizeTokens(key, tokens);

  const minor = isMinorish(key.scale);
  // optional modal mixture
  const tok = tokens.slice();
  const rootOf = (t: ProgToken): number =>
    rootOffsetOf(key, tokenToTemplate(t, 'triad', 1));
  for (let i = 1; i < n; i++) {
    if (typeof tok[i] === 'number' && chance(rng, mood.borrowChance)) {
      const opts = minor ? BORROW_OPTIONS_MINORISH : BORROW_OPTIONS_MAJORISH;
      const b = weightedPick(rng, opts);
      const r = rootOf(b);
      const neighbours = [rootOf(tok[i - 1]!), rootOf(tok[(i + 1) % n]!)];
      if (neighbours.every((x) => x !== r && !isTritone(x, r))) tok[i] = b;
    }
  }

  const templates: ChordTemplate[] = tok.map((t, i) => {
    const base = tokenToTemplate(t, 'triad', lengths[i]!);
    const isTonic = base.degree === 0;
    return { ...base, color: colorFor(rng, mood, base, isTonic) };
  });
  return realizeProgression(key, templates);
}

// ---------------------------------------------------------------------------------------------
// mutation (long-term evolution)
// ---------------------------------------------------------------------------------------------

interface SubCandidate {
  tpl: ChordTemplate;
  weight: number;
}

function substitutionCandidates(key: KeySpec, templates: ChordTemplate[], i: number): SubCandidate[] {
  const n = templates.length;
  const cur = templates[i]!;
  const prev = templates[(i - 1 + n) % n]!;
  const next = templates[(i + 1) % n]!;
  const prevRoot = rootOffsetOf(key, prev);
  const nextRoot = rootOffsetOf(key, next);
  const curRoot = rootOffsetOf(key, cur);
  const out: SubCandidate[] = [];

  const consider = (tpl: ChordTemplate, weight: number): void => {
    const r = rootOffsetOf(key, tpl);
    if (r === prevRoot || r === nextRoot) return;
    if (isTritone(r, prevRoot) || isTritone(r, nextRoot)) return;
    if (isDimChord(key, tpl)) return;
    if (r === curRoot && tpl.color === cur.color) return;
    out.push({ tpl, weight });
  };

  // colour changes on the same chord: the gentlest, most musical substitution
  const colors: ChordColor[] = ['triad', 'seventh', 'add9', 'ninth', 'sus2', 'sus4'];
  for (const c of colors) {
    if (c === cur.color) continue;
    if (cur.degree === undefined && (c === 'sus4' || c === 'ninth')) continue;
    consider({ ...cur, color: c }, 1.6);
  }
  if (cur.degree !== undefined) {
    const d = cur.degree;
    consider({ degree: (d + 2) % 7, color: cur.color, bars: cur.bars }, 2.2); // relative / third substitution
    consider({ degree: (d + 5) % 7, color: cur.color, bars: cur.bars }, 2.2);
    consider({ degree: (d + 1) % 7, color: cur.color, bars: cur.bars }, 0.8);
    consider({ degree: (d + 6) % 7, color: cur.color, bars: cur.bars }, 0.8);
  }
  // parallel / borrowed chords
  const opts = isMinorish(key.scale) ? BORROW_OPTIONS_MINORISH : BORROW_OPTIONS_MAJORISH;
  for (const [name, w] of opts) {
    const b = BORROWED[name];
    consider({ offset: b.offset, quality: b.quality, color: cur.color === 'seventh' ? 'triad' : 'add9', bars: cur.bars }, w * 0.6);
  }
  return out;
}

/**
 * Substitute 1-2 chords with related chords (relative / parallel / borrowed / colour changes). Never touches
 * the first chord, never creates tritone root motion or diminished triads. amount 0..1.
 */
export function mutateProgression(prog: Progression, rng: Rng, amount: number): Progression {
  const n = prog.chords.length;
  if (n < 2) return prog;
  const a = Math.max(0, Math.min(1, amount));
  let count: number;
  if (a < 0.12) count = chance(rng, a * 6) ? 1 : 0;
  else count = a > 0.5 && chance(rng, a * 0.8) ? 2 : 1;
  if (count === 0) return prog;
  const templates = templatesOf(prog);
  const order = shuffle(
    rng,
    Array.from({ length: n - 1 }, (_, i) => i + 1),
  );
  let applied = 0;
  for (const idx of order) {
    if (applied >= count) break;
    const cands = substitutionCandidates(prog.key, templates, idx);
    if (cands.length === 0) continue;
    const pick = weightedPick(
      rng,
      cands.map((c) => [c.tpl, c.weight] as const),
    );
    templates[idx] = pick;
    applied++;
  }
  return realizeProgression(prog.key, templates);
}

// ---------------------------------------------------------------------------------------------
// keys / modulation
// ---------------------------------------------------------------------------------------------

/** Brightness order of modes, used to find neighbouring parallel modes. */
const BRIGHTNESS: ScaleName[] = ['lydian', 'ionian', 'mixolydian', 'dorian', 'aeolian', 'phrygian', 'locrian'];

/**
 * Pick a closely related key for a pivot modulation: fifth up/down, relative major/minor, or a
 * neighbouring parallel mode. If `allowed` is given only those scales are produced.
 */
export function relatedKey(key: KeySpec, rng: Rng, allowed?: readonly ScaleName[]): KeySpec {
  const cands: Array<readonly [KeySpec, number]> = [];
  const seen = new Set<string>();
  const add = (k: KeySpec, w: number): void => {
    if (allowed && !allowed.includes(k.scale)) return;
    if (keysEqual(k, key)) return;
    const id = `${k.tonic}:${k.scale}`;
    if (seen.has(id)) return;
    seen.add(id);
    cands.push([k, w]);
  };
  const t = key.tonic;
  add({ tonic: mod12(t + 7), scale: key.scale }, 3);
  add({ tonic: mod12(t + 5), scale: key.scale }, 3);
  // relative keys (same pitch collection)
  const relMajor = mod12(t - SCALE_MODE_OFFSET[key.scale]);
  add({ tonic: relMajor, scale: 'ionian' }, 3);
  add({ tonic: mod12(relMajor + 9), scale: 'aeolian' }, 3);
  // parallel neighbours
  const bi = BRIGHTNESS.indexOf(key.scale);
  for (const j of [bi - 1, bi + 1]) {
    const s = BRIGHTNESS[j];
    if (s && s !== 'locrian') add({ tonic: t, scale: s }, 2);
  }
  if (allowed && !allowed.includes(key.scale)) {
    // coming from another mood's palette: stay as close as possible in tonic, adopt an allowed scale
    for (const s of allowed) {
      add({ tonic: t, scale: s }, 4);
      add({ tonic: mod12(t + 7), scale: s }, 1);
      add({ tonic: mod12(t + 5), scale: s }, 1);
      add({ tonic: mod12(t + 3), scale: s }, 1.2);
      add({ tonic: mod12(t + 9), scale: s }, 1.2);
    }
  }
  if (cands.length === 0) return { tonic: mod12(t + 7), scale: allowed?.[0] ?? key.scale };
  return weightedPick(rng, cands);
}

/** Pivot-chord weights by the degree the chord has in the *new* key. */
const PIVOT_FUNCTION_WEIGHT = [0.4, 2.5, 1.5, 3.5, 5, 2, 3];

/**
 * Find a chord diatonic in `from` that is also diatonic in `to` and acts as a predominant/dominant there.
 * Returns a template in the `from` key (it is played at the end of the old section). null if none.
 */
export function findPivotTemplate(
  from: KeySpec,
  to: KeySpec,
  rng: Rng,
  bars: number,
  avoidRootPc?: number,
): ChordTemplate | null {
  const toPcs = scalePcs(to);
  const toScale = SCALE_INTERVALS[to.scale];
  const cands: Array<readonly [ChordTemplate, number]> = [];
  for (let d = 0; d < 7; d++) {
    const triad = buildChord(from, { degree: d, color: 'triad', bars });
    if (triad.intervals[2] === 6) continue;
    if (!triad.pcs.every((p) => toPcs.includes(p))) continue;
    if (avoidRootPc !== undefined && triad.rootPc === avoidRootPc) continue;
    const j = toScale.indexOf(mod12(triad.rootPc - to.tonic));
    const w = j >= 0 ? PIVOT_FUNCTION_WEIGHT[j]! : 0.5;
    const colorOptions: ChordColor[] = ['triad'];
    for (const c of ['seventh', 'add9'] as ChordColor[]) {
      const ch = buildChord(from, { degree: d, color: c, bars });
      if (ch.pcs.every((p) => toPcs.includes(p))) colorOptions.push(c);
    }
    const color = weightedPick(
      rng,
      colorOptions.map((c) => [c, c === 'triad' ? 1 : 1.5] as const),
    );
    cands.push([{ degree: d, color, bars }, w]);
  }
  if (cands.length === 0) return null;
  return weightedPick(rng, cands);
}

// ---------------------------------------------------------------------------------------------
// voice leading
// ---------------------------------------------------------------------------------------------

export const PAD_LO = 48;
export const PAD_HI = 76;
export const PAD_CENTER = 62;
export const BASS_LO = 28;
export const BASS_HI = 48;
export const BASS_ROOT_HI = 45;

/** Voice-leading distance between two voicings (symmetric nearest-voice distance + register drift). */
export function voicingDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let s = 0;
  for (const x of b) {
    let m = Infinity;
    for (const y of a) m = Math.min(m, Math.abs(x - y));
    s += m;
  }
  for (const y of a) {
    let m = Infinity;
    for (const x of b) m = Math.min(m, Math.abs(x - y));
    s += m;
  }
  const meanA = a.reduce((p, c) => p + c, 0) / a.length;
  const meanB = b.reduce((p, c) => p + c, 0) / b.length;
  return s + 0.6 * Math.abs(meanA - meanB);
}

const MAX_CANDIDATES = 24;

/** All sensible voicings (one note per distinct chord pitch class) in [lo, hi], best static scores first. */
export function voicingCandidates(chord: RealChord, open = 0.3, lo = PAD_LO, hi = PAD_HI): number[][] {
  const pcs = Array.from(new Set(chord.pcs));
  const options: number[][] = pcs.map((pc) => {
    const o: number[] = [];
    for (let m = lo; m <= hi; m++) if (mod12(m) === pc) o.push(m);
    return o;
  });
  const results: Array<{ v: number[]; score: number }> = [];
  const maxSpan = 17 + Math.round(open * 7);
  const maxGap = open > 0.6 ? 14 : 12;
  const rec = (i: number, cur: number[]): void => {
    if (i === options.length) {
      const v = cur.slice().sort((a, b) => a - b);
      for (let k = 1; k < v.length; k++) {
        const gap = v[k]! - v[k - 1]!;
        const minGap = v[k - 1]! < 58 ? 3 : 2;
        if (gap < minGap || gap > maxGap) return;
      }
      const span = v[v.length - 1]! - v[0]!;
      if (span > maxSpan) return;
      const mean = v.reduce((p, c) => p + c, 0) / v.length;
      let score = Math.abs(mean - PAD_CENTER) * 0.4;
      score += (1 - open) * Math.max(0, span - 12) * 0.25;
      score -= open * span * 0.15;
      // tight major seconds in the middle register get muddy: mild penalty
      for (let k = 1; k < v.length; k++) if (v[k]! - v[k - 1]! === 2) score += 0.8;
      const lowPc = mod12(v[0]!);
      if (lowPc === chord.rootPc) score -= 0.3 + open * 0.6;
      else if (lowPc === mod12(chord.rootPc + 7)) score -= open * 0.3;
      results.push({ v, score });
      return;
    }
    for (const m of options[i]!) {
      cur.push(m);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, MAX_CANDIDATES).map((r) => r.v);
}

export interface VoiceLeadOptions {
  /** voicing the previous section ended on (smooth section joins) */
  prev?: readonly number[] | null;
  open?: number;
}

/**
 * Choose one voicing per chord of a looping progression minimising total voice movement, including the
 * wrap-around from the last chord back to the first (cyclic dynamic programming).
 */
export function voiceLeadLoop(chords: readonly RealChord[], opts: VoiceLeadOptions = {}): number[][] {
  const n = chords.length;
  if (n === 0) return [];
  const open = opts.open ?? 0.3;
  const cands = chords.map((c) => voicingCandidates(c, open));
  for (let i = 0; i < n; i++) {
    if (cands[i]!.length === 0) {
      // extremely unusual: relax the range
      cands[i] = voicingCandidates(chords[i]!, 1, PAD_LO - 5, PAD_HI + 7);
    }
  }
  let best: { cost: number; path: number[] } | null = null;
  const first = cands[0]!;
  for (let s = 0; s < first.length; s++) {
    let cost = new Array<number>(cands[0]!.length).fill(Infinity);
    const back: number[][] = [];
    cost[s] = opts.prev ? voicingDistance(opts.prev, first[s]!) : 0;
    for (let i = 1; i < n; i++) {
      const next = new Array<number>(cands[i]!.length).fill(Infinity);
      const bp = new Array<number>(cands[i]!.length).fill(0);
      for (let k = 0; k < cands[i]!.length; k++) {
        for (let j = 0; j < cands[i - 1]!.length; j++) {
          if (cost[j]! === Infinity) continue;
          const c = cost[j]! + voicingDistance(cands[i - 1]![j]!, cands[i]![k]!);
          if (c < next[k]!) {
            next[k] = c;
            bp[k] = j;
          }
        }
      }
      cost = next;
      back.push(bp);
    }
    // close the loop
    for (let k = 0; k < cands[n - 1]!.length; k++) {
      const total = cost[k]! + (n > 1 ? voicingDistance(cands[n - 1]![k]!, first[s]!) : 0);
      if (!best || total < best.cost) {
        const path = new Array<number>(n).fill(0);
        path[n - 1] = k;
        for (let i = n - 1; i >= 1; i--) path[i - 1] = back[i - 1]![path[i]!]!;
        path[0] = s;
        best = { cost: total, path };
      }
    }
  }
  return best!.path.map((k, i) => cands[i]![k]!.slice());
}

/** Voicing for a single chord (e.g. a pivot chord) led from `prev` and, optionally, toward `next`. */
export function voiceLeadChord(
  chord: RealChord,
  prev: readonly number[] | null,
  next: readonly number[] | null,
  open = 0.3,
): number[] {
  const cands = voicingCandidates(chord, open);
  let bestV = cands[0] ?? [];
  let bestC = Infinity;
  for (const v of cands) {
    const c = (prev ? voicingDistance(prev, v) : 0) + (next ? voicingDistance(v, next) * 0.8 : 0);
    if (c < bestC) {
      bestC = c;
      bestV = v;
    }
  }
  return bestV.slice();
}

// ---------------------------------------------------------------------------------------------
// bass roots
// ---------------------------------------------------------------------------------------------

/** Bass root for a pitch class: within MIDI 28..45, nearest to the previous root (default ~E2/F2). */
export function bassRootMidi(pc: number, prev?: number | null): number {
  const target = prev ?? 36;
  let best = BASS_LO;
  let bestScore = Infinity;
  for (let m = BASS_LO; m <= BASS_ROOT_HI; m++) {
    if (mod12(m) !== pc) continue;
    const score = Math.abs(m - target) + 0.12 * Math.abs(m - 36);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

export function bassRootsForChords(chords: readonly RealChord[], prev?: number | null): number[] {
  const out: number[] = [];
  let p = prev ?? null;
  for (const c of chords) {
    const r = bassRootMidi(c.rootPc, p);
    out.push(r);
    p = r;
  }
  return out;
}
