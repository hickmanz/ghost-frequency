/**
 * Last-pass harmonic color for the Developed engine.
 * Pass 0 keeps the section's original chords and voicings. The final pass substitutes one
 * related chord (or lengthens the tonic) and is voice-led from the end of the previous pass.
 * The Form's SectionPlan is never mutated.
 */
import type { SectionPlan } from '../composition/plan';
import {
  bassRootsForChords,
  mutateProgression,
  realizeProgression,
  templatesOf,
  voiceLeadLoop,
  type Progression,
} from '../composition/harmony';
import { MOODS } from '../composition/moods';
import { stream } from '../composition/rng';
import type { ChordTemplate, RealChord } from '../composition/theory';

export interface ArrangedSection {
  plan: SectionPlan;
  /** Chord-loop length of the original plan, in bars. */
  sourceLoop: number;
  passCount: number;
}

export function sectionSignature(plan: SectionPlan): string {
  const chords = plan.progression.chords.map((c) => `${c.label}:${c.bars}`).join('|');
  return `${plan.index}:${plan.lengthBars}:${plan.pivot?.bars ?? 0}:${plan.key.tonic}:${plan.key.scale}:${chords}`;
}

function tplSig(ts: readonly ChordTemplate[]): string {
  return ts.map((t) => `${t.degree ?? 'x'}:${t.offset ?? ''}:${t.quality ?? ''}:${t.color}:${t.bars}`).join('/');
}

/** If substitution did nothing, hold the tonic one bar longer by borrowing from another chord. */
function lengthenTonic(templates: readonly ChordTemplate[]): ChordTemplate[] {
  const out = templates.map((t) => ({ ...t }));
  const tonic = out.findIndex((t) => t.degree === 0);
  if (tonic < 0) return out;
  const donor = out.findIndex((t, i) => i !== tonic && t.bars >= 2);
  if (donor < 0) return out;
  out[donor]!.bars -= 1;
  out[tonic]!.bars += 1;
  return out;
}

function colorLastLoop(plan: SectionPlan, seed: number): ChordTemplate[] {
  const templates = templatesOf(plan.progression);
  const rng = stream(seed, 'develop', 'color', plan.index);
  const mutated = templatesOf(mutateProgression(realizeProgression(plan.key, templates), rng, 0.55));
  if (tplSig(mutated) !== tplSig(templates)) return mutated;
  return lengthenTonic(templates);
}

export function arrangeSection(plan: SectionPlan, seed: number): ArrangedSection {
  const sourceLoop = Math.max(1, plan.progression.loopBars);
  const body = plan.pivot ? Math.max(sourceLoop, plan.lengthBars - plan.pivot.bars) : plan.lengthBars;
  const passCount = Math.max(1, Math.floor(body / sourceLoop));
  if (passCount < 2) return { plan, sourceLoop, passCount };

  const chords: RealChord[] = [];
  const voicings: number[][] = [];
  const bassRoots: number[] = [];
  for (let p = 0; p < passCount - 1; p++) {
    chords.push(...plan.progression.chords);
    for (const v of plan.voicings) voicings.push(v.slice());
    bassRoots.push(...plan.bassRoots);
  }

  const mood = MOODS[plan.mood];
  const last = realizeProgression(plan.key, colorLastLoop(plan, seed));
  const prevVoice = plan.voicings[plan.voicings.length - 1] ?? null;
  const lastVoices = voiceLeadLoop(last.chords, { prev: prevVoice, open: mood.padOpen });
  const prevRoot = plan.bassRoots[plan.bassRoots.length - 1] ?? null;
  chords.push(...last.chords);
  voicings.push(...lastVoices);
  bassRoots.push(...bassRootsForChords(last.chords, prevRoot));

  const progression: Progression = {
    key: plan.key,
    chords,
    loopBars: chords.reduce((s, c) => s + c.bars, 0),
  };
  const arranged: SectionPlan = {
    ...plan,
    progression,
    voicings,
    bassRoots,
    _segKey: undefined,
    _segs: undefined,
  };
  return { plan: arranged, sourceLoop, passCount };
}
