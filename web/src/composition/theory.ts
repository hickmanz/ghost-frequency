/**
 * Pure music theory helpers: scales, keys, chord construction, labels, pitch utilities.
 * No randomness, no DOM, no Tone.js.
 */
import type { ChordSpec, KeySpec, ScaleName } from '@shared/index';

// ---------------------------------------------------------------------------------------------
// pitch-class utilities
// ---------------------------------------------------------------------------------------------

export const mod = (n: number, m: number): number => ((n % m) + m) % m;
export const mod12 = (n: number): number => mod(n, 12);
export const pcOf = (midi: number): number => mod12(midi);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(Number.isFinite(x) ? x : 0, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export function pitchClassName(pc: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]!;
}

/** e.g. 60 -> "C4" */
export function midiName(midi: number, flats = false): string {
  return `${pitchClassName(midi, flats)}${Math.floor(midi / 12) - 1}`;
}

// ---------------------------------------------------------------------------------------------
// scales / keys
// ---------------------------------------------------------------------------------------------

export const SCALE_INTERVALS: Record<ScaleName, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

/** Semitones from the relative-major tonic up to this mode's tonic (used for spelling and relatives). */
export const SCALE_MODE_OFFSET: Record<ScaleName, number> = {
  ionian: 0,
  dorian: 2,
  phrygian: 4,
  lydian: 5,
  mixolydian: 7,
  aeolian: 9,
  locrian: 11,
  harmonicMinor: 9,
};

export const SCALE_LABEL: Record<ScaleName, string> = {
  ionian: 'major',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'minor',
  locrian: 'locrian',
  harmonicMinor: 'harmonic minor',
};

/** true when the third degree is minor */
export function isMinorish(scale: ScaleName): boolean {
  return SCALE_INTERVALS[scale][2] === 3;
}

export function keysEqual(a: KeySpec, b: KeySpec): boolean {
  return a.tonic === b.tonic && a.scale === b.scale;
}

/** Whether to spell this key with flats (based on its relative major). */
export function keyUsesFlats(key: KeySpec): boolean {
  const relMajor = mod12(key.tonic - SCALE_MODE_OFFSET[key.scale]);
  return relMajor === 5 || relMajor === 10 || relMajor === 3 || relMajor === 8 || relMajor === 1;
}

/** e.g. "A minor", "D dorian" */
export function keyLabel(key: KeySpec): string {
  return `${pitchClassName(key.tonic, keyUsesFlats(key))} ${SCALE_LABEL[key.scale]}`;
}

/** Pitch classes (sorted by scale degree order) of the key. */
export function scalePcs(key: KeySpec): number[] {
  return SCALE_INTERVALS[key.scale].map((i) => mod12(key.tonic + i));
}

export function inKey(key: KeySpec, midiOrPc: number): boolean {
  return scalePcs(key).includes(mod12(midiOrPc));
}

const SCALE_BASE_MIDI = 60;

/**
 * Scale-index space: index 0 is the tonic at MIDI 60..71 (C4 + tonic), +7 is the next octave.
 * Negative indices go below. This is the coordinate system melodic code works in.
 */
export function scaleIndexToMidi(key: KeySpec, idx: number): number {
  const scale = SCALE_INTERVALS[key.scale];
  return SCALE_BASE_MIDI + key.tonic + 12 * Math.floor(idx / 7) + scale[mod(idx, 7)]!;
}

/** Nearest scale index for a MIDI pitch (ties resolve downward). */
export function midiToScaleIndex(key: KeySpec, midi: number): number {
  const scale = SCALE_INTERVALS[key.scale];
  const rel = midi - (SCALE_BASE_MIDI + key.tonic);
  const oct = Math.floor(rel / 12);
  const r = rel - 12 * oct;
  let best = 0;
  let bestDist = Infinity;
  for (let j = 0; j <= 7; j++) {
    const v = j === 7 ? 12 : scale[j]!;
    const dist = Math.abs(v - r);
    if (dist < bestDist) {
      bestDist = dist;
      best = j;
    }
  }
  return oct * 7 + best;
}

export function snapToScale(key: KeySpec, midi: number): number {
  return scaleIndexToMidi(key, midiToScaleIndex(key, midi));
}

/** Scale degree (0..6) whose pitch class is nearest to the given pitch class. */
export function nearestScaleDegree(key: KeySpec, pc: number): number {
  const scale = SCALE_INTERVALS[key.scale];
  const rel = mod12(pc - key.tonic);
  let best = 0;
  let bestDist = Infinity;
  for (let d = 0; d < 7; d++) {
    const dist = Math.min(mod12(scale[d]! - rel), mod12(rel - scale[d]!));
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// nearest-pitch helpers
// ---------------------------------------------------------------------------------------------

/** Pitch with the given pitch class nearest to `target` (ties go down). */
export function nearestMidiWithPc(target: number, pc: number): number {
  const up = target + mod12(pc - target);
  const down = up - 12;
  return up - target < target - down ? up : down;
}

/** Nearest pitch to `target` whose pitch class is in `pcs`. */
export function nearestInPcs(target: number, pcs: readonly number[]): number {
  let best = target;
  let bestDist = Infinity;
  for (const pc of pcs) {
    const m = nearestMidiWithPc(target, pc);
    const d = Math.abs(m - target);
    if (d < bestDist || (d === bestDist && m < best)) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

/** Octave-shift a pitch into [lo, hi]; if the window is narrower than an octave, the nearest edge wins. */
export function foldIntoRange(midi: number, lo: number, hi: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  if (m < lo) return clamp(midi, lo, hi);
  return m;
}

// ---------------------------------------------------------------------------------------------
// chords
// ---------------------------------------------------------------------------------------------

export type ChordColor = 'triad' | 'seventh' | 'add9' | 'ninth' | 'sus2' | 'sus4' | 'quartal';

/**
 * Key-independent chord description used by progressions.
 *  - diatonic: `degree` 0..6 (chord is stacked from the key's scale, so it always belongs to the key)
 *  - borrowed: `offset` semitones above the tonic + `quality` ('M' | 'm'); flagged `borrowed` if it leaves the scale
 */
export interface ChordTemplate {
  degree?: number;
  offset?: number;
  quality?: 'M' | 'm';
  color: ChordColor;
  /** length in bars */
  bars: number;
}

export interface RealChord {
  template: ChordTemplate;
  rootPc: number;
  /** ascending semitone intervals above the root, e.g. [0,3,7,14] */
  intervals: number[];
  label: string;
  numeral: string;
  /** true when any chord tone is outside the key's scale (declared borrowed chord) */
  borrowed: boolean;
  /** nearest diatonic scale degree of the root (melodic anchor) */
  anchorDegree: number;
  bars: number;
  /** pitch classes, in interval order */
  pcs: number[];
}

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'] as const;

export function numeralFor(offset: number, third: number, fifth: number): string {
  let n: string = ROMAN[mod12(offset)]!;
  if (third < 4) n = n.toLowerCase();
  if (fifth === 6) n += '\u00b0';
  return n;
}

function intervalSetForColor(
  color: ChordColor,
  at: (k: number) => number,
): { intervals: number[]; color: ChordColor } {
  const third = at(2);
  const fifth = at(4);
  const seventh = at(6);
  const ninth = at(8);
  const triad = { intervals: [0, third, fifth], color: 'triad' as ChordColor };
  const sus2 = at(1) === 2 && fifth === 7 ? { intervals: [0, 2, fifth], color: 'sus2' as ChordColor } : triad;
  switch (color) {
    case 'triad':
      return triad;
    case 'seventh':
      return { intervals: [0, third, fifth, seventh], color };
    case 'add9':
      if (ninth % 12 === 1) return triad;
      return { intervals: [0, third, fifth, ninth], color };
    case 'ninth':
      if (ninth % 12 === 1) return { intervals: [0, third, fifth, seventh], color: 'seventh' };
      return { intervals: [0, third, fifth, seventh, ninth], color };
    case 'sus2':
      return sus2;
    case 'sus4':
      if (at(3) === 5 && fifth === 7) return { intervals: [0, 5, fifth], color };
      return sus2;
    case 'quartal': {
      if (at(3) === 5 && at(6) === 10) {
        const top = at(9);
        return { intervals: top - 10 === 5 ? [0, 5, 10, top] : [0, 5, 10], color };
      }
      if (at(3) === 5 && fifth === 7) return { intervals: [0, 5, fifth], color: 'sus4' };
      return sus2;
    }
  }
}
function sortedUnique(iv: number[]): number[] {
  return Array.from(new Set(iv)).sort((a, b) => a - b);
}

/** Build a concrete chord (in a key) from a template. */
export function buildChord(key: KeySpec, tpl: ChordTemplate): RealChord {
  const scale = SCALE_INTERVALS[key.scale];
  let rootOffset: number;
  let intervals: number[];
  let numeralThird = 4;
  let color: ChordColor = tpl.color;
  if (tpl.degree !== undefined) {
    const d = mod(tpl.degree, 7);
    rootOffset = scale[d]!;
    const at = (k: number): number => {
      const idx = d + k;
      return scale[mod(idx, 7)]! + 12 * Math.floor(idx / 7) - scale[d]!;
    };
    numeralThird = at(2);
    const r = intervalSetForColor(tpl.color, at);
    intervals = r.intervals;
    color = r.color;
  } else {
    const off = mod12(tpl.offset ?? 0);
    rootOffset = off;
    const major = (tpl.quality ?? 'M') === 'M';
    numeralThird = major ? 4 : 3;
    // semitone offsets for scale-degree steps k = 0..9 above the root
    const steps: number[] = [0, 2, major ? 4 : 3, 5, 7, 9, major ? 11 : 10, 12, 14, 17];
    const at = (k: number): number => steps[k]!;
    const r = intervalSetForColor(tpl.color, at);
    intervals = r.intervals;
    color = r.color;
    if (tpl.color === 'quartal') intervals = [0, 5, 10, 15];
  }
  intervals = sortedUnique(intervals);
  const rootPc = mod12(key.tonic + rootOffset);
  const keyPcs = scalePcs(key);
  const pcs = intervals.map((i) => mod12(rootPc + i));
  const borrowed = pcs.some((p) => !keyPcs.includes(p));
  const fifth = intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7;
  const flats = keyUsesFlats(key);
  return {
    template: tpl,
    rootPc,
    intervals,
    label: chordLabel(rootPc, intervals, flats, color),
    numeral: numeralFor(rootOffset, numeralThird, fifth) + (color === 'sus2' ? 'sus2' : color === 'sus4' ? 'sus4' : ''),
    borrowed,
    anchorDegree: nearestScaleDegree(key, rootPc),
    bars: tpl.bars,
    pcs,
  };
}

/** Human chord label, e.g. 'Am9', 'Fmaj7', 'Dsus2', 'Gadd9'. */
export function chordLabel(rootPc: number, intervals: readonly number[], flats = false, color?: ChordColor): string {
  const name = pitchClassName(rootPc, flats);
  const pcs = new Set(intervals.map((i) => mod12(i)));
  const has = (n: number): boolean => pcs.has(mod12(n));
  const hasNinthAbove = intervals.some((i) => i >= 12 && mod12(i) === 2);
  const hasFlat9 = intervals.some((i) => i >= 12 && mod12(i) === 1);
  const seventh = has(11) ? 'maj' : has(10) ? 'min' : has(9) && has(6) && !has(7) ? 'dim' : '';
  if (color === 'quartal') {
    return `${name}${seventh === 'maj' ? 'maj7' : '7'}sus4`;
  }
  if (color === 'sus2' || color === 'sus4') {
    const sus = color === 'sus2' ? 'sus2' : 'sus4';
    return `${name}${seventh === 'maj' ? 'maj7' : seventh === 'min' ? '7' : ''}${sus}`;
  }
  const major3 = has(4);
  const minor3 = has(3);
  const dim5 = has(6) && !has(7);
  const aug5 = has(8) && !has(7) && major3;
  let q = '';
  if (minor3 && dim5) q = seventh === 'min' ? 'm7b5' : seventh === 'dim' ? 'dim7' : 'dim';
  else if (minor3) {
    if (seventh === 'maj') q = hasNinthAbove ? 'm(maj9)' : 'm(maj7)';
    else if (seventh === 'min') q = hasNinthAbove ? 'm9' : 'm7';
    else q = hasNinthAbove ? 'madd9' : 'm';
  } else if (major3) {
    if (seventh === 'maj') q = hasNinthAbove ? 'maj9' : 'maj7';
    else if (seventh === 'min') q = hasNinthAbove ? '9' : '7';
    else q = hasNinthAbove ? 'add9' : aug5 ? 'aug' : '';
  } else if (has(5)) q = 'sus4';
  else if (has(2)) q = 'sus2';
  if (hasFlat9) q += 'b9';
  return `${name}${q}`;
}

/** Convert a realised chord to the event-schema ChordSpec. root sits in the 36..47 bass-reference octave. */
export function toChordSpec(chord: RealChord): ChordSpec {
  return {
    root: 36 + chord.rootPc,
    label: chord.label,
    numeral: chord.numeral,
    intervals: chord.intervals.slice(),
  };
}

export function chordPitchClasses(rootPc: number, intervals: readonly number[]): number[] {
  return intervals.map((i) => mod12(rootPc + i));
}

/** Is `pc` a semitone (or tritone) away from some chord tone, without being one itself? */
export function clashesWithChord(pc: number, chordPcs: readonly number[]): boolean {
  if (chordPcs.includes(pc)) return false;
  return chordPcs.some((c) => {
    const d = mod12(pc - c);
    return d === 1 || d === 11;
  });
}

/** Range of useful chord-tone pitches (all octaves) within [lo, hi]. */
export function pitchesInRange(pcs: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m);
  return out;
}
