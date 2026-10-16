/**
 * Per-mood musical configuration + the progression grammar.
 * Pure data; consumed by harmony / form / layers.
 */
import type { MoodId, ScaleName } from '@shared/index';
import type { ChordColor } from './theory';

export type SectionName = 'Intro' | 'Drift' | 'Build' | 'Peak' | 'Breakdown' | 'Outro';
export const SECTION_NAMES: readonly SectionName[] = ['Intro', 'Drift', 'Build', 'Peak', 'Breakdown', 'Outro'];

export type ArpFamily = 'up' | 'updown' | 'broken' | 'skip' | 'pedal' | 'dotted';
export type DrumStyle = 'minimal' | 'soft' | 'halftime' | 'fourfloor';
export type DrumTier = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------------------------
// progression grammar
// ---------------------------------------------------------------------------------------------

/** A progression token: diatonic degree (0..6) or a named borrowed chord. */
export type ProgToken = number | BorrowedName;
export type BorrowedName = 'bII' | 'II' | 'bIII' | 'iv' | 'V' | 'bVI' | 'bVII';

export const BORROWED: Record<BorrowedName, { offset: number; quality: 'M' | 'm' }> = {
  bII: { offset: 1, quality: 'M' },
  II: { offset: 2, quality: 'M' },
  bIII: { offset: 3, quality: 'M' },
  iv: { offset: 5, quality: 'm' },
  V: { offset: 7, quality: 'M' },
  bVI: { offset: 8, quality: 'M' },
  bVII: { offset: 10, quality: 'M' },
};

export interface Grammar {
  /** transitions[from][to] = weight over diatonic degrees 0..6 */
  transitions: number[][];
  /** weights for the first chord */
  start: number[];
  /** weights for the final chord (pulls back to the start) */
  cadence: number[];
}

const Z = [0, 0, 0, 0, 0, 0, 0];

const AEOLIAN: Grammar = {
  transitions: [
    [0, 0, 2, 2.5, 1, 3, 3],
    [1, 0, 0, 1, 3, 0, 0],
    [1.5, 0, 0, 1.5, 1, 2.5, 3],
    [2, 0, 1, 0, 1, 1.5, 2.5],
    [2.5, 0, 1.5, 0.5, 0, 2, 1],
    [2, 0, 2, 1.5, 0.5, 0, 3.5],
    [3.5, 0, 2, 1, 0.5, 1.5, 0],
  ],
  start: [12, 0, 1, 0.5, 0, 2.5, 0.5],
  cadence: [0, 0, 0.5, 1.5, 3, 1.5, 5],
};

const DORIAN: Grammar = {
  transitions: [
    [0, 0.8, 1.5, 3, 1, 0, 2.5],
    [2, 0, 1, 2.5, 1, 0, 1],
    [1.5, 0, 0, 2.5, 1, 0, 3],
    [2.5, 0.8, 1, 0, 1.5, 0, 3],
    [2.5, 0, 1.5, 1.5, 0, 0, 2],
    Z,
    [3, 0, 1.5, 3, 0.5, 0, 0],
  ],
  start: [12, 0, 1, 2, 0, 0, 1],
  cadence: [0, 0, 0.5, 3, 1.5, 0, 4],
};

const PHRYGIAN: Grammar = {
  transitions: [
    [0, 3.5, 1.5, 1.5, 0, 2, 2],
    [3.5, 0, 1.5, 0.5, 0, 1, 1.5],
    [1.5, 2, 0, 1, 0, 2, 2.5],
    [2, 1, 1, 0, 0, 1.5, 2.5],
    Z,
    [2, 1.5, 1.5, 1, 0, 0, 3],
    [3, 1.5, 1, 1, 0, 1.5, 0],
  ],
  start: [12, 0.5, 0.5, 1, 0, 1.5, 0.5],
  cadence: [0, 3, 0.5, 1, 0, 1, 3],
};

const IONIAN: Grammar = {
  transitions: [
    [0, 1, 1.5, 3, 3, 3, 0],
    [1, 0, 1, 1.5, 3, 1, 0],
    [1, 1, 0, 3, 1, 2.5, 0],
    [2.5, 1, 0.8, 0, 3, 2, 0],
    [3, 0.5, 0.5, 1.5, 0, 3, 0],
    [1.5, 2, 1, 3, 2.5, 0, 0],
    Z,
  ],
  start: [12, 0.5, 0.5, 1, 0.3, 2, 0],
  cadence: [0, 1, 0, 2, 4, 0.5, 0],
};

const LYDIAN: Grammar = {
  transitions: [
    [0, 3.5, 1.5, 0, 2, 2.5, 0.5],
    [3, 0, 1, 0, 2.5, 1.5, 0.5],
    [1.5, 2, 0, 0, 1.5, 2, 1],
    Z,
    [3, 2, 1, 0, 0, 3, 1],
    [1.5, 2.5, 1.5, 0, 2.5, 0, 1],
    [2, 1.5, 1, 0, 1.5, 1.5, 0],
  ],
  start: [12, 1, 0.5, 0, 0.5, 1.5, 0],
  cadence: [0, 3, 0.5, 0, 3, 1, 1],
};

const MIXOLYDIAN: Grammar = {
  transitions: [
    [0, 1, 0, 3, 1, 2, 3],
    [1, 0, 0, 2, 1, 1, 2],
    Z,
    [2.5, 1, 0, 0, 1, 1.5, 3],
    [2.5, 0, 0, 1.5, 0, 2, 1.5],
    [1.5, 1.5, 0, 3, 1, 0, 2.5],
    [3, 1, 0, 3, 0.5, 1.5, 0],
  ],
  start: [12, 0.5, 0, 1.5, 0, 1, 1],
  cadence: [0, 0, 0, 2, 1, 0, 4],
};

export const GRAMMARS: Record<ScaleName, Grammar> = {
  aeolian: AEOLIAN,
  dorian: DORIAN,
  phrygian: PHRYGIAN,
  ionian: IONIAN,
  lydian: LYDIAN,
  mixolydian: MIXOLYDIAN,
  locrian: PHRYGIAN,
  harmonicMinor: AEOLIAN,
};

/** Borrowed-chord options used when a mood allows modal mixture, by scale family. */
export const BORROW_OPTIONS_MINORISH: ReadonlyArray<readonly [BorrowedName, number]> = [
  ['V', 1],
  ['bVII', 1.5],
  ['bVI', 1],
];
export const BORROW_OPTIONS_MAJORISH: ReadonlyArray<readonly [BorrowedName, number]> = [
  ['bVII', 3],
  ['iv', 3],
  ['bVI', 2],
  ['bIII', 1],
];

/** Modal-mixture chords that make sense for a scale (lydian keeps its raised 4th, so no minor iv). */
export function borrowOptionsFor(scale: ScaleName): ReadonlyArray<readonly [BorrowedName, number]> {
  if (scale === 'lydian') return [['bVII', 2], ['bIII', 0.6]];
  if (scale === 'ionian' || scale === 'mixolydian') return BORROW_OPTIONS_MAJORISH;
  return BORROW_OPTIONS_MINORISH;
}

export type CanonicalList = ReadonlyArray<readonly [readonly ProgToken[], number]>;

// ---------------------------------------------------------------------------------------------
// mood configuration
// ---------------------------------------------------------------------------------------------

export interface MoodConfig {
  id: MoodId;
  label: string;
  scales: ReadonlyArray<readonly [ScaleName, number]>;
  /** weights for tonic pitch class 0..11 */
  tonicWeights: readonly number[];
  tempo: readonly [number, number];
  /** chord length templates (bars per chord, sum 8 or 16) */
  chordBars: ReadonlyArray<readonly [readonly number[], number]>;
  /** chance to use a hand-written classic progression instead of the Markov grammar */
  canonicalChance: number;
  canonical: Partial<Record<ScaleName, CanonicalList>>;
  /** chance a non-tonic chord becomes a borrowed chord */
  borrowChance: number;
  colors: ReadonlyArray<readonly [ChordColor, number]>;
  tonicColors: ReadonlyArray<readonly [ChordColor, number]>;
  /** 0..1: preference for wide, open pad voicings */
  padOpen: number;
  arp: {
    density: number;
    families: ReadonlyArray<readonly [ArpFamily, number]>;
  };
  bass: { pedalChance: number; activity: number };
  lead: {
    /** inclusive MIDI register */
    register: readonly [number, number];
    center: number;
    /** multiplies the probability of playing a phrase */
    activity: number;
    /** 0..1: preference for long sustained notes */
    longBias: number;
  };
  drums: { maxTier: DrumTier; style: DrumStyle };
  texture: { noise: number; drone: number };
  /** automation baselines for send.reverb / send.delay (0.5 = neutral for the renderer) */
  fx: { reverb: number; delay: number };
  sectionBias: Partial<Record<SectionName, number>>;
}

const TONIC_WEIGHTS_DEFAULT = [2, 1.2, 2, 1, 2.5, 2, 1.2, 2, 1, 3, 1, 1.5];

export const MOODS: Record<MoodId, MoodConfig> = {
  dreamy: {
    id: 'dreamy',
    label: 'Dreamy',
    scales: [['lydian', 0.5], ['ionian', 0.5]],
    tonicWeights: TONIC_WEIGHTS_DEFAULT,
    tempo: [84, 100],
    chordBars: [[[2, 2, 2, 2], 4], [[2, 2, 2, 1, 1], 1], [[4, 4, 4, 4], 1]],
    canonicalChance: 0.55,
    canonical: {
      ionian: [[[0, 2, 5, 3], 3], [[0, 3, 5, 4], 2], [[3, 0, 4, 5], 2], [[0, 4, 5, 3], 2]],
      lydian: [[[0, 1, 5, 4], 2.5], [[0, 1, 4, 1], 2], [[0, 5, 1, 4], 2], [[0, 2, 1, 5], 1.5]],
    },
    borrowChance: 0.04,
    colors: [['add9', 3], ['seventh', 3], ['ninth', 1.5], ['triad', 0.8], ['sus2', 0.7]],
    tonicColors: [['seventh', 3], ['add9', 3], ['ninth', 1.5]],
    padOpen: 0.4,
    arp: {
      density: 0.55,
      families: [['updown', 2], ['up', 2], ['broken', 2], ['dotted', 1.5], ['skip', 1]],
    },
    bass: { pedalChance: 0.0, activity: 0.8 },
    lead: { register: [64, 88], center: 74, activity: 1.0, longBias: 0.55 },
    drums: { maxTier: 2, style: 'soft' },
    texture: { noise: 0.35, drone: 0.6 },
    fx: { reverb: 0.62, delay: 0.56 },
    sectionBias: { Drift: 1.2, Peak: 0.9 },
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    scales: [['aeolian', 0.6], ['phrygian', 0.4]],
    tonicWeights: TONIC_WEIGHTS_DEFAULT,
    tempo: [70, 90],
    chordBars: [[[2, 2, 2, 2], 3], [[4, 4, 4, 4], 2], [[2, 2, 4, 4, 4], 1]],
    canonicalChance: 0.5,
    canonical: {
      aeolian: [[[0, 5, 3, 4], 2], [[0, 6, 5, 4], 2], [[0, 3, 5, 6], 1.5], [[0, 5, 6, 3], 1.5]],
      phrygian: [[[0, 1, 2, 1], 2], [[0, 6, 5, 1], 1.5], [[0, 1, 5, 6], 2], [[0, 1, 6, 1], 2]],
    },
    borrowChance: 0.08,
    colors: [['triad', 2], ['add9', 3], ['seventh', 2], ['sus2', 1], ['ninth', 0.5]],
    tonicColors: [['add9', 3], ['triad', 2], ['seventh', 1.5]],
    padOpen: 0.5,
    arp: {
      density: 0.5,
      families: [['pedal', 3], ['up', 2], ['skip', 1.5], ['broken', 1], ['updown', 1]],
    },
    bass: { pedalChance: 0.45, activity: 0.85 },
    lead: { register: [57, 79], center: 66, activity: 0.8, longBias: 0.6 },
    drums: { maxTier: 3, style: 'halftime' },
    texture: { noise: 0.55, drone: 1.0 },
    fx: { reverb: 0.58, delay: 0.46 },
    sectionBias: { Breakdown: 1.2, Peak: 0.9 },
  },
  nostalgic: {
    id: 'nostalgic',
    label: 'Nostalgic',
    scales: [['aeolian', 0.65], ['ionian', 0.2], ['dorian', 0.15]],
    tonicWeights: TONIC_WEIGHTS_DEFAULT,
    tempo: [90, 110],
    chordBars: [[[2, 2, 2, 2], 5], [[2, 2, 2, 1, 1], 1], [[2, 2, 2, 2, 2, 2, 2, 2], 1]],
    canonicalChance: 0.7,
    canonical: {
      aeolian: [
        [[0, 5, 2, 6], 3],
        [[0, 6, 5, 6], 3],
        [[5, 6, 0, 4], 1.5],
        [[0, 3, 6, 2], 1.5],
        [[0, 2, 6, 5], 2],
        [[5, 6, 0, 3], 1],
      ],
      dorian: [[[0, 3, 0, 6], 3], [[0, 6, 3, 6], 2], [[0, 2, 3, 6], 2]],
      ionian: [[[0, 4, 5, 3], 3], [[5, 3, 0, 4], 2], [[0, 3, 5, 4], 2], [[0, 'bVII', 3, 4], 1.5]],
    },
    borrowChance: 0.14,
    colors: [['triad', 3], ['seventh', 2.5], ['add9', 2], ['sus4', 0.6], ['ninth', 0.5]],
    tonicColors: [['triad', 2.5], ['add9', 2], ['seventh', 2]],
    padOpen: 0.25,
    arp: {
      density: 0.72,
      families: [['up', 2.5], ['updown', 2], ['broken', 2], ['skip', 1.5], ['dotted', 2]],
    },
    bass: { pedalChance: 0.1, activity: 1.0 },
    lead: { register: [62, 84], center: 72, activity: 1.1, longBias: 0.4 },
    drums: { maxTier: 3, style: 'fourfloor' },
    texture: { noise: 0.35, drone: 0.5 },
    fx: { reverb: 0.52, delay: 0.56 },
    sectionBias: { Peak: 1.2, Build: 1.1 },
  },
  space: {
    id: 'space',
    label: 'Space',
    scales: [['dorian', 0.5], ['lydian', 0.5]],
    tonicWeights: TONIC_WEIGHTS_DEFAULT,
    tempo: [60, 76],
    chordBars: [[[4, 4, 4, 4], 4], [[2, 2, 4, 4, 4], 1]],
    canonicalChance: 0.45,
    canonical: {
      dorian: [[[0, 3, 6, 3], 3], [[0, 2, 3, 6], 2], [[0, 6, 3, 2], 1.5]],
      lydian: [[[0, 1, 4, 1], 2], [[0, 2, 1, 5], 2], [[0, 1, 5, 2], 1.5]],
    },
    borrowChance: 0.02,
    colors: [['sus2', 2.5], ['sus4', 2], ['quartal', 2], ['add9', 2.5], ['triad', 1], ['seventh', 1]],
    tonicColors: [['add9', 3], ['sus2', 2.5], ['quartal', 2]],
    padOpen: 0.9,
    arp: {
      density: 0.35,
      families: [['up', 2], ['skip', 2], ['pedal', 1.5], ['updown', 1.5]],
    },
    bass: { pedalChance: 0.55, activity: 0.5 },
    lead: { register: [67, 91], center: 79, activity: 0.7, longBias: 0.8 },
    drums: { maxTier: 1, style: 'minimal' },
    texture: { noise: 0.6, drone: 1.2 },
    fx: { reverb: 0.78, delay: 0.62 },
    sectionBias: { Drift: 1.5, Breakdown: 1.3, Peak: 0.5, Build: 0.8 },
  },
};

export function moodConfig(id: MoodId): MoodConfig {
  return MOODS[id];
}
