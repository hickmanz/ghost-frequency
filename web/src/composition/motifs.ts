/**
 * Motifs: short singable melodic cells (rhythm + scale-degree contour) generated per piece from the seed,
 * with variation operators and a usage history so earlier themes return in later sections.
 *
 * A motif's `step` values are scale-degree offsets relative to an anchor (the root of whichever chord the
 * motif is realised over). Steps 0/2/4 (mod 7) are therefore chord tones (root/3rd/5th) of that chord.
 */
import type { KeySpec } from '@shared/index';
import type { MoodConfig } from './moods';
import { chance, int, pick, stream, weightedPick, type Rng } from './rng';
import { mod, scaleIndexToMidi, type RealChord } from './theory';

export interface MotifNote {
  /** beat offset from phrase start */
  t: number;
  dur: number;
  /** scale-degree offset from the anchor chord root */
  step: number;
}

export interface Motif {
  id: number;
  /** nominal length in beats (2, 4 or 8) */
  beats: number;
  notes: MotifNote[];
  tag: string;
}

export interface MotifBank {
  seed: number;
  motifs: Motif[];
}

export interface MotifHistory {
  /** motif id -> section indices it was used in */
  uses: Record<number, number[]>;
}

const CELLS_4: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 1.5], [1.5, 0.5], [2, 2]],
  [[0, 1], [1, 1], [2, 2]],
  [[0, 2], [2, 1], [3, 1]],
  [[0, 1.5], [1.5, 1.5], [3, 1]],
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]],
  [[0.5, 1], [1.5, 0.5], [2, 1.5]],
  [[0, 3], [3, 1]],
  [[0, 1], [1.5, 0.5], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
];

const CELLS_8: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 2], [2, 1], [3, 1], [4, 3]],
  [[0, 3], [3, 1], [4, 2], [6, 2]],
  [[0, 1.5], [1.5, 0.5], [2, 2], [4, 1.5], [5.5, 0.5], [6, 2]],
  [[0, 2], [2, 2], [4, 1], [5, 1], [6, 2]],
  [[0, 1], [1, 1], [2, 2], [4, 2], [6, 2]],
];

const isChordStep = (step: number): boolean => {
  const m = mod(step, 7);
  return m === 0 || m === 2 || m === 4;
};

function nearestChordStep(step: number, prefer: number): number {
  let best = step;
  let bestScore = Infinity;
  for (const d of [0, 1, -1, 2, -2, 3, -3]) {
    const c = step + d;
    if (!isChordStep(c)) continue;
    const score = Math.abs(d) - (Math.sign(d) === Math.sign(prefer) ? 0.1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function generateContour(rng: Rng, n: number): number[] {
  const steps: number[] = [weightedPick(rng, [[0, 3], [2, 3], [4, 2], [-3, 1]] as const)];
  let lastMove = 0;
  for (let i = 1; i < n; i++) {
    const cur = steps[i - 1]!;
    const afterLeap = Math.abs(lastMove) >= 3;
    const options: Array<readonly [number, number]> = [];
    const candidates: Array<readonly [number, number]> = [
      [1, 3], [-1, 3], [0, 0.6], [2, 1.3], [-2, 1.3], [3, 0.5], [-3, 0.5], [4, 0.2], [-4, 0.2],
    ];
    for (const [mv, w0] of candidates) {
      let w = w0;
      const next = cur + mv;
      if (next < -5 || next > 7) continue;
      if (afterLeap && (Math.sign(mv) === Math.sign(lastMove) || Math.abs(mv) > 2 || mv === 0)) continue;
      if (mv === 0 && lastMove === 0) continue;
      if (Math.abs(cur) > 4 && Math.sign(mv) === -Math.sign(cur)) w *= 3;
      // gentle arch: tend to rise in the first half and fall in the second
      const rising = i < n / 2;
      if ((rising && mv > 0) || (!rising && mv < 0)) w *= 1.4;
      options.push([mv, w]);
    }
    const mv = options.length ? weightedPick(rng, options) : 0;
    steps.push(cur + mv);
    lastMove = mv;
  }
  // end on a chord tone
  const last = steps.length - 1;
  if (!isChordStep(steps[last]!)) {
    steps[last] = nearestChordStep(steps[last]!, steps.length > 1 ? Math.sign(steps[last]! - steps[last - 1]!) : 1);
  }
  // first note is already a chord tone; avoid ending on exactly the previous pitch
  if (steps.length > 1 && steps[last] === steps[last - 1]) {
    steps[last] = nearestChordStep(steps[last]! + (chance(rng, 0.5) ? 1 : -1), 0);
  }
  return steps;
}

export function generateMotif(rng: Rng, mood: MoodConfig, id: number): Motif {
  const long = chance(rng, 0.3 + 0.2 * mood.lead.longBias);
  const cells = long ? CELLS_8 : CELLS_4;
  const weighted = cells.map((c) => {
    const avg = c.reduce((s, n) => s + n[1], 0) / c.length;
    return [c, Math.max(0.2, 1 + mood.lead.longBias * (avg - 1))] as const;
  });
  const cell = weightedPick(rng, weighted);
  const contour = generateContour(rng, cell.length);
  return {
    id,
    beats: long ? 8 : 4,
    notes: cell.map(([t, dur], i) => ({ t, dur, step: contour[i]! })),
    tag: 'orig',
  };
}

export function createMotifBank(seed: number, mood: MoodConfig, count = 3): MotifBank {
  const bank: MotifBank = { seed, motifs: [] };
  for (let i = 0; i < count; i++) addMotif(bank, mood);
  return bank;
}

export function addMotif(bank: MotifBank, mood: MoodConfig): Motif {
  const id = bank.motifs.length;
  const m = generateMotif(stream(bank.seed, 'motif', id, mood.id), mood, id);
  bank.motifs.push(m);
  return m;
}

export function getMotif(bank: MotifBank, id: number): Motif {
  return bank.motifs[id] ?? bank.motifs[0]!;
}

// ---------------------------------------------------------------------------------------------
// variation operators (all pure; return new motifs)
// ---------------------------------------------------------------------------------------------

const cloneMotif = (m: Motif, tag: string): Motif => ({
  id: m.id,
  beats: m.beats,
  notes: m.notes.map((n) => ({ ...n })),
  tag,
});

const snap25 = (x: number): number => Math.round(x * 4) / 4;

/** Syncopate: push an inner note half a beat later or earlier (or add a half-beat pickup delay). */
export function rhythmicDisplace(m: Motif, rng: Rng): Motif {
  const out = cloneMotif(m, 'displace');
  const n = out.notes.length;
  if (n < 2) return out;
  const lastEnd = out.notes[n - 1]!.t + out.notes[n - 1]!.dur;
  if (chance(rng, 0.3) && lastEnd + 0.5 <= out.beats) {
    for (const note of out.notes) note.t += 0.5;
    return out;
  }
  const i = int(rng, 1, n - 1);
  const cur = out.notes[i]!;
  const prev = out.notes[i - 1]!;
  if (chance(rng, 0.5) && cur.dur > 0.5) {
    prev.dur += 0.5;
    cur.t += 0.5;
    cur.dur -= 0.5;
  } else if (prev.dur > 0.5) {
    prev.dur -= 0.5;
    cur.t -= 0.5;
    cur.dur += 0.5;
  }
  return out;
}

/** Insert a neighbour or passing tone (half a beat) into a longer note. */
export function ornament(m: Motif, rng: Rng): Motif {
  const out = cloneMotif(m, 'ornament');
  const idxs: number[] = [];
  out.notes.forEach((n, i) => {
    if (n.dur >= 1.5) idxs.push(i);
  });
  if (idxs.length === 0) return out;
  const i = pick(rng, idxs);
  const note = out.notes[i]!;
  const next = out.notes[i + 1];
  const insertAt = i + 1;
  if (next && Math.abs(next.step - note.step) === 2 && chance(rng, 0.6)) {
    // passing tone toward the next note
    note.dur -= 0.5;
    out.notes.splice(insertAt, 0, { t: note.t + note.dur, dur: 0.5, step: (note.step + next.step) / 2 });
  } else {
    // upper / lower neighbour, then return to the main note
    const dir = chance(rng, 0.65) ? 1 : -1;
    const main = note.dur;
    note.dur = main - 1;
    out.notes.splice(
      insertAt,
      0,
      { t: note.t + note.dur, dur: 0.5, step: note.step + dir },
      { t: note.t + note.dur + 0.5, dur: 0.5, step: note.step },
    );
  }
  return out;
}

/** Keep only the first k notes (at least 2), holding the final one. */
export function truncate(m: Motif, keep: number): Motif {
  const out = cloneMotif(m, 'truncate');
  const k = Math.max(Math.min(2, out.notes.length), Math.min(keep, out.notes.length));
  out.notes = out.notes.slice(0, k);
  const last = out.notes[k - 1]!;
  last.dur = Math.max(last.dur, 1.5);
  const end = last.t + last.dur;
  out.beats = end <= 4 ? 4 : 8;
  if (end > out.beats) last.dur = out.beats - last.t;
  return out;
}

/** Stretch time by `factor` (2 = half speed). Notes falling past 8 beats are dropped. */
export function augment(m: Motif, factor = 2): Motif {
  const out = cloneMotif(m, 'augment');
  out.notes = out.notes
    .map((n) => ({ ...n, t: snap25(n.t * factor), dur: snap25(n.dur * factor) }))
    .filter((n) => n.t < 8);
  out.beats = Math.min(8, m.beats * factor);
  for (const n of out.notes) if (n.t + n.dur > out.beats) n.dur = out.beats - n.t;
  return out;
}

/** Compress time by `factor` (2 = double speed). */
export function diminish(m: Motif, factor = 2): Motif {
  const out = cloneMotif(m, 'diminish');
  out.notes = out.notes.map((n) => ({ ...n, t: snap25(n.t / factor), dur: Math.max(0.25, snap25(n.dur / factor)) }));
  out.beats = Math.max(2, m.beats / factor);
  return out;
}

/** Mirror the contour around its first note. */
export function invert(m: Motif): Motif {
  const out = cloneMotif(m, 'invert');
  const first = out.notes[0]!.step;
  for (const n of out.notes) n.step = 2 * first - n.step;
  return out;
}

export type VariationOp = 'displace' | 'ornament' | 'truncate' | 'augment' | 'diminish' | 'invert';

export function applyVariation(m: Motif, op: VariationOp, rng: Rng): Motif {
  switch (op) {
    case 'displace':
      return rhythmicDisplace(m, rng);
    case 'ornament':
      return ornament(m, rng);
    case 'truncate':
      return truncate(m, Math.max(2, Math.ceil(m.notes.length * 0.6)));
    case 'augment':
      return m.beats <= 4 ? augment(m, 2) : ornament(m, rng);
    case 'diminish':
      return m.beats >= 4 ? diminish(m, 2) : m;
    case 'invert':
      return invert(m);
  }
}

/** Apply 0-2 weighted variation operators; `strength` 0..1 (usually the user's variation param). */
export function varyMotif(m: Motif, rng: Rng, strength: number): Motif {
  let out = m;
  const ops: Array<readonly [VariationOp, number]> = [
    ['displace', 3],
    ['ornament', 3],
    ['truncate', 1.5],
    ['augment', 1],
    ['diminish', 0.6],
    ['invert', 0.5],
  ];
  if (chance(rng, strength * 0.9)) {
    out = applyVariation(out, weightedPick(rng, ops), rng);
    if (strength > 0.65 && chance(rng, 0.35)) out = applyVariation(out, weightedPick(rng, ops.slice(0, 3)), rng);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// realisation
// ---------------------------------------------------------------------------------------------

export interface RealNote {
  t: number;
  dur: number;
  midi: number;
  /** true when the note sits on a strong beat / is long / is the final note */
  strong: boolean;
}

export interface RealizeContext {
  key: KeySpec;
  chord: RealChord;
  register: readonly [number, number];
  center: number;
}

/** Map a motif's contour onto the scale, anchored on the chord root nearest the register centre. */
export function transposeToChord(m: Motif, ctx: RealizeContext): RealNote[] {
  const { key, chord, register, center } = ctx;
  const meanStep = m.notes.reduce((s, n) => s + n.step, 0) / Math.max(1, m.notes.length);
  let anchor = chord.anchorDegree;
  let bestDist = Infinity;
  for (let k = -4; k <= 4; k++) {
    const idx = chord.anchorDegree + 7 * k;
    const mid = scaleIndexToMidi(key, Math.round(idx + meanStep));
    const d = Math.abs(mid - center);
    if (d < bestDist) {
      bestDist = d;
      anchor = idx;
    }
  }
  const out: RealNote[] = [];
  const lastIndex = m.notes.length - 1;
  m.notes.forEach((n, i) => {
    let idx = anchor + n.step;
    const strong = (n.t % 2 === 0 && n.dur >= 1) || n.dur >= 1.5 || i === lastIndex;
    let midi = scaleIndexToMidi(key, idx);
    if (strong && !chord.pcs.includes(mod(midi, 12))) {
      for (const d of [-1, 1, -2, 2]) {
        const cand = scaleIndexToMidi(key, idx + d);
        if (chord.pcs.includes(mod(cand, 12))) {
          idx += d;
          midi = cand;
          break;
        }
      }
    }
    while (midi > register[1]) midi -= 12;
    while (midi < register[0]) midi += 12;
    out.push({ t: n.t, dur: n.dur, midi, strong });
  });
  // no overlaps
  out.sort((a, b) => a.t - b.t);
  for (let i = 0; i < out.length - 1; i++) {
    const room = out[i + 1]!.t - out[i]!.t;
    if (out[i]!.dur > room) out[i]!.dur = room;
  }
  return out.filter((n) => n.dur > 0.05);
}

// ---------------------------------------------------------------------------------------------
// long-term form: which motifs does each section use?
// ---------------------------------------------------------------------------------------------

export function createHistory(): MotifHistory {
  return { uses: {} };
}

/**
 * Choose 1-2 motif ids for a section. Mostly the piece's principal theme, sometimes an earlier motif that
 * has not been heard recently (reintroduction), occasionally a brand-new motif added to the bank.
 */
export function selectMotifs(
  bank: MotifBank,
  history: MotifHistory,
  rng: Rng,
  sectionIndex: number,
  mood: MoodConfig,
  /** 0..1: higher = more likely to bring back an older theme */
  recall = 0.5,
): number[] {
  const recall01 = recall < 0 ? 0 : recall > 1 ? 1 : recall;
  const ids = bank.motifs.map((m) => m.id);
  const useCount = (id: number): number => history.uses[id]?.length ?? 0;
  const lastUse = (id: number): number => {
    const u = history.uses[id];
    return u && u.length ? u[u.length - 1]! : -99;
  };
  let primary: number;
  if (sectionIndex === 0) {
    primary = ids[0]!;
  } else {
    const principal = ids.slice().sort((a, b) => useCount(b) - useCount(a) || a - b)[0]!;
    const stale = ids.filter((id) => sectionIndex - lastUse(id) >= 3 && useCount(id) > 0);
    const r = rng.next();
    const principalCut = 0.5 - recall01 * 0.38;
    const staleCut = 0.78 + recall01 * 0.17;
    if (r < principalCut) primary = principal;
    else if (r < staleCut && stale.length > 0) primary = pick(rng, stale);
    else if (r < 0.9 && bank.motifs.length < 5) primary = addMotif(bank, mood).id;
    else primary = pick(rng, ids);
  }
  const chosen = [primary];
  if (chance(rng, 0.55 + recall01 * 0.28)) {
    const others = bank.motifs.map((m) => m.id).filter((id) => id !== primary);
    if (others.length) chosen.push(weightedPick(rng, others.map((id) => [id, 1 + useCount(id)] as const)));
  }
  for (const id of chosen) (history.uses[id] ??= []).push(sectionIndex);
  return chosen;
}
