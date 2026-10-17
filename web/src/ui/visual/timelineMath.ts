import type { KeySpec, LayerId } from '@shared/index';

/** Pure helpers for the song-structure timeline (unit-tested). No DOM access. */

export const BEATS_PER_BAR = 4;
/** Playhead sits at this fraction of the width; content scrolls left. */
export const PLAYHEAD_FRAC = 0.75;
/** Default number of bars shown behind the playhead. */
export const PAST_BARS = 48;

/** Number of past bars to show for a canvas of `width` CSS px (fewer on narrow screens so bars stay legible). */
export function pastBarsFor(width: number): number {
  if (width < 380) return 20;
  if (width < 560) return 32;
  return PAST_BARS;
}

/** Horizontal pixels per beat so that `pastBars` bars fit between the left edge and the playhead. */
export function pxPerBeatFor(width: number, pastBars = PAST_BARS): number {
  return (Math.max(1, width) * PLAYHEAD_FRAC) / (pastBars * BEATS_PER_BAR);
}

export function beatToX(beat: number, nowBeat: number, playheadX: number, pxPerBeat: number): number {
  return playheadX + (beat - nowBeat) * pxPerBeat;
}

export function xToBeat(x: number, nowBeat: number, playheadX: number, pxPerBeat: number): number {
  return nowBeat + (x - playheadX) / pxPerBeat;
}

/** Beats visible at the left/right edge of a canvas of `width` px (from clamped to >= 0). */
export function visibleBeatRange(
  nowBeat: number,
  width: number,
  playheadX: number,
  pxPerBeat: number,
): { from: number; to: number } {
  const from = nowBeat - playheadX / pxPerBeat;
  const to = nowBeat + (width - playheadX) / pxPerBeat;
  return { from: from < 0 ? 0 : from, to };
}

/** Smallest power-of-two bar stride such that labels are at least `minPx` apart. */
export function barLabelStride(barPx: number, minPx = 30): number {
  let s = 1;
  while (s < 64 && barPx * s < minPx) s *= 2;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------------------------

/** Lane order top -> bottom (roughly high register to low). */
export const LANE_ORDER: readonly LayerId[] = ['lead', 'bell', 'arp', 'pad', 'texture', 'bass', 'drums'];

export function laneIndex(layer: LayerId): number {
  const i = LANE_ORDER.indexOf(layer);
  return i < 0 ? LANE_ORDER.length - 1 : i;
}

/** Display range (MIDI) per melodic lane, used to place notes vertically inside the lane. */
const PITCH_RANGE: Record<LayerId, readonly [number, number]> = {
  lead: [55, 100],
  arp: [45, 100],
  pad: [33, 90],
  texture: [30, 100],
  bass: [24, 60],
  drums: [36, 49],
  bell: [60, 96],
};

/** Vertical position inside a lane, 0 = bottom .. 1 = top (clamped). */
export function notePitchFrac(layer: LayerId, midi: number): number {
  const [lo, hi] = PITCH_RANGE[layer];
  const v = (midi - lo) / (hi - lo);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Drum sub-row inside the drums lane: 0 = top (crash/tom/other), 1 = hats, 2 = snare/clap, 3 = kick (bottom). */
export function drumRow(midi: number): number {
  switch (midi) {
    case 36:
      return 3;
    case 38:
    case 39:
      return 2;
    case 42:
    case 46:
      return 1;
    default:
      return 0;
  }
}

export const GAIN_TARGET_PREFIX = 'layer.gain.';

/** Lane layer for an automation target like 'layer.gain.bass' (null for other targets). */
export function gainTargetLayer(target: string): LayerId | null {
  if (!target.startsWith(GAIN_TARGET_PREFIX)) return null;
  const id = target.slice(GAIN_TARGET_PREFIX.length);
  return (LANE_ORDER as readonly string[]).includes(id) ? (id as LayerId) : null;
}

/**
 * Insert (beat,value,ramp) into parallel arrays kept sorted by beat. When full, the oldest entry is dropped.
 * Returns the new count. Allocation-free.
 */
export function insertBreakpoint(
  beats: Float64Array,
  values: Float32Array,
  ramps: Float32Array,
  count: number,
  beat: number,
  value: number,
  ramp: number,
): number {
  let n = count;
  const cap = beats.length;
  if (n === cap) {
    for (let i = 1; i < n; i++) {
      beats[i - 1] = beats[i]!;
      values[i - 1] = values[i]!;
      ramps[i - 1] = ramps[i]!;
    }
    n--;
  }
  let i = n;
  while (i > 0 && beats[i - 1]! > beat) {
    beats[i] = beats[i - 1]!;
    values[i] = values[i - 1]!;
    ramps[i] = ramps[i - 1]!;
    i--;
  }
  beats[i] = beat;
  values[i] = value;
  ramps[i] = ramp;
  return n + 1;
}

/** Effective gain at `beat` from sorted breakpoints (a ramp counts as halfway at its start; 1 before the first). */
export function gainAtBeat(
  beats: Float64Array,
  values: Float32Array,
  ramps: Float32Array,
  count: number,
  beat: number,
): number {
  let g = 1;
  for (let i = 0; i < count; i++) {
    if (beats[i]! + ramps[i]! * 0.5 > beat) break;
    g = values[i]!;
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

export interface SectionLike {
  index: number;
  name: string;
  startBeat: number;
  endBeat: number;
  energy: number;
  key: KeySpec;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const NAMED_HUES: Record<string, number> = {
  intro: 205, // cool blue
  drift: 265, // violet
  build: 320, // magenta
  peak: 28, // hot orange
  breakdown: 170, // teal
  outro: 235,
};

/** Colour (HSL) for a section name; unknown names get a stable hash-derived hue. */
export function sectionColor(name: string): Hsl {
  const key = name.trim().toLowerCase();
  const named = NAMED_HUES[key];
  if (named !== undefined) return { h: named, s: 92, l: 60 };
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return { h: h % 360, s: 85, l: 62 };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Short key label, e.g. "A minor", "D dorian". */
export function keyShortLabel(key: KeySpec): string {
  const t = ((key.tonic % 12) + 12) % 12;
  const scale = key.scale === 'ionian' ? 'major' : key.scale === 'aeolian' ? 'minor' : key.scale === 'harmonicMinor' ? 'harm. minor' : key.scale;
  return `${NOTE_NAMES[t]} ${scale}`;
}

/** Index of the last section with startBeat <= beat, or -1. Sections are sorted oldest first. */
export function findSectionIndex(sections: readonly SectionLike[], beat: number): number {
  let lo = 0;
  let hi = sections.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid]!.startBeat <= beat) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Section energy at `beat`, cross-faded from the previous section's energy over `rampBeats` after a boundary.
 * Before the first section the first energy is returned; with no sections, `fallback`.
 */
export function energyAtBeat(sections: readonly SectionLike[], beat: number, rampBeats = 4, fallback = 0.5): number {
  if (sections.length === 0) return fallback;
  const i = findSectionIndex(sections, beat);
  if (i <= 0) return sections[0]!.energy;
  const cur = sections[i]!;
  const prev = sections[i - 1]!;
  const t = rampBeats > 0 ? (beat - cur.startBeat) / rampBeats : 1;
  if (t >= 1) return cur.energy;
  const s = t <= 0 ? 0 : t * t * (3 - 2 * t);
  return prev.energy + (cur.energy - prev.energy) * s;
}

/** Linear sample of per-bar values (value i centred on bar firstBar + i + 0.5) at `beat`; clamps at the ends. */
export function sampleBarValues(values: Float32Array, count: number, firstBar: number, beat: number): number {
  if (count <= 0) return 0;
  const pos = beat / BEATS_PER_BAR - 0.5 - firstBar;
  if (pos <= 0) return values[0]!;
  if (pos >= count - 1) return values[count - 1]!;
  const i = Math.floor(pos);
  const f = pos - i;
  return values[i]! + (values[i + 1]! - values[i]!) * f;
}
