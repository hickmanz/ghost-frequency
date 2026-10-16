/**
 * Section plan types + pure helpers shared by form.ts, the layer generators and the engine.
 */
import type { KeySpec, LayerId, MoodId } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import type { Progression } from './harmony';
import type { ArpFamily, DrumTier, SectionName } from './moods';
import { clamp01, lerp, type RealChord } from './theory';

export type { ArpFamily, DrumTier, SectionName };

/** Style of the transition between two sections (applied to the end of A and the start of B). */
export type TransitionStyle = 'sweep' | 'dip' | 'swell';

export interface PivotPlan {
  chord: RealChord;
  voicing: number[];
  bassRoot: number;
  /** bars at the end of the section occupied by the pivot chord */
  bars: number;
}

/** [startBar, endBar) relative to section start. */
export type BarInterval = readonly [number, number];

export interface SectionPlan {
  index: number;
  name: SectionName;
  /** mood the section was planned with (harmony follows this, layers follow live params) */
  mood: MoodId;
  startBar: number;
  lengthBars: number;
  /** length used for the energy curve (does not change if the section is shortened) */
  curveBars: number;
  key: KeySpec;
  progression: Progression;
  /** pad voicing per progression chord */
  voicings: number[][];
  /** bass root MIDI per progression chord */
  bassRoots: number[];
  pivot?: PivotPlan;
  energy: { from: number; start: number; end: number };
  /** per layer: bar intervals (relative) where the layer plays */
  layers: Record<LayerId, BarInterval[]>;
  /** layer was already audible at the end of the previous section (no entry ramp at bar 0) */
  joinsPrev: Record<LayerId, boolean>;
  /** layer is audible at the end of this section but not at the start of the next (needs exit ramp) */
  leavesAtEnd: Record<LayerId, boolean>;
  motifIds: number[];
  drumTierCap: DrumTier;
  arpFamily: ArpFamily;
  bassPedal: boolean;
  /** transition style coming in from the previous section */
  entry?: TransitionStyle;
  /** transition style going out to the next section */
  exit?: TransitionStyle;
  exitKeyChange: boolean;
  /** internal cache */
  _segKey?: string;
  _segs?: PlanSegment[];
}

export interface PlanSegment {
  /** relative start bar */
  startBar: number;
  bars: number;
  chord: RealChord;
  voicing: number[];
  bassRoot: number;
  isPivot: boolean;
}

export const planEnd = (plan: SectionPlan): number => plan.startBar + plan.lengthBars;

export function allLayers<T>(f: (l: LayerId) => T): Record<LayerId, T> {
  const out = {} as Record<LayerId, T>;
  for (const l of LAYER_IDS) out[l] = f(l);
  return out;
}

/** Drop cached segments after the plan was mutated (shortened / pivot added). */
export function invalidatePlan(plan: SectionPlan): void {
  plan._segKey = undefined;
  plan._segs = undefined;
}

/** Chord segments (bar-aligned) covering the whole section, with pivot and truncation applied. */
export function chordSegments(plan: SectionPlan): PlanSegment[] {
  const key = `${plan.lengthBars}:${plan.pivot ? plan.pivot.bars : 0}`;
  if (plan._segs && plan._segKey === key) return plan._segs;
  const segs: PlanSegment[] = [];
  const limit = plan.pivot ? plan.lengthBars - plan.pivot.bars : plan.lengthBars;
  const chords = plan.progression.chords;
  let pos = 0;
  while (pos < limit && chords.length > 0) {
    for (let i = 0; i < chords.length && pos < limit; i++) {
      const c = chords[i]!;
      const bars = Math.min(c.bars, limit - pos);
      segs.push({
        startBar: pos,
        bars,
        chord: c,
        voicing: plan.voicings[i]!,
        bassRoot: plan.bassRoots[i]!,
        isPivot: false,
      });
      pos += bars;
    }
  }
  if (plan.pivot) {
    segs.push({
      startBar: limit,
      bars: plan.pivot.bars,
      chord: plan.pivot.chord,
      voicing: plan.pivot.voicing,
      bassRoot: plan.pivot.bassRoot,
      isPivot: true,
    });
  }
  plan._segs = segs;
  plan._segKey = key;
  return segs;
}

/** Index of the segment containing a relative bar (clamped). */
export function segmentIndexAt(plan: SectionPlan, rel: number): number {
  const segs = chordSegments(plan);
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i]!.startBar <= rel) return i;
  return 0;
}

export function segmentAt(plan: SectionPlan, rel: number): PlanSegment {
  const segs = chordSegments(plan);
  return segs[segmentIndexAt(plan, rel)]!;
}

export function lastSegment(plan: SectionPlan): PlanSegment {
  const segs = chordSegments(plan);
  return segs[segs.length - 1]!;
}

/** Is `layer` scheduled to play at relative bar `rel`? */
export function layerOn(plan: SectionPlan, layer: LayerId, rel: number): boolean {
  if (rel < 0 || rel >= plan.lengthBars) return false;
  for (const [s, e] of plan.layers[layer]) if (rel >= s && rel < e) return true;
  return false;
}

/** Section energy curve (0..1) at a (fractional) relative bar, blended from the previous section's end. */
export function sectionCurve(plan: SectionPlan, rel: number): number {
  const t = clamp01((rel + 0.5) / Math.max(1, plan.curveBars));
  const base = lerp(plan.energy.start, plan.energy.end, t);
  const blend = clamp01(rel / 2);
  return lerp(plan.energy.from, base, blend);
}

/** Section curve combined with the live user energy param: 0..1. */
export function effectiveEnergy(plan: SectionPlan, rel: number, userEnergy: number): number {
  return clamp01(userEnergy + (sectionCurve(plan, rel) - 0.5) * 0.7);
}
