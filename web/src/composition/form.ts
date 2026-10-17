/**
 * Long-term form: a state machine over sections (Intro, Drift, Build, Peak, Breakdown, Outro -> new cycle).
 * Sections are planned lazily, one ahead, from section-keyed rng streams so the plan for a section depends
 * only on (seed, section index, the state of the previous sections and the params at planning time).
 */
import type { GenerationParams, KeySpec, LayerId, MoodId, ScaleName } from '@shared/index';
import {
  bassRootMidi,
  bassRootsForChords,
  findPivotTemplate,
  generateProgression,
  mutateProgression,
  realizeProgression,
  relatedKey,
  templatesOf,
  voiceLeadChord,
  voiceLeadLoop,
  type Progression,
} from './harmony';
import {
  createHistory,
  createMotifBank,
  selectMotifs,
  type MotifBank,
  type MotifHistory,
} from './motifs';
import { MOODS, type ArpFamily, type DrumTier, type MoodConfig, type SectionName } from './moods';
import {
  allLayers,
  invalidatePlan,
  lastSegment,
  layerOn,
  planEnd,
  segmentAt,
  type BarInterval,
  type SectionPlan,
  type TransitionStyle,
} from './plan';
import { chance, jitter, pick, stream, weightedPick, type Rng } from './rng';
import { buildChord, clamp01, keysEqual } from './theory';

/** Bars before a section's end at which the next section gets planned (and the current plan is "locked"). */
export const LOCK_BARS = 4;
/** Section plans fully behind playback are dropped (keeps `prev()` / joins valid for recent boundaries). */
export const PLAN_KEEP_BARS = 128;

const NEXT_SECTION: Record<SectionName, ReadonlyArray<readonly [SectionName, number]>> = {
  Intro: [['Drift', 8], ['Build', 2]],
  Drift: [['Build', 6], ['Breakdown', 1.5], ['Drift', 2.5]],
  Build: [['Peak', 8.5], ['Drift', 1.5]],
  Peak: [['Breakdown', 5.5], ['Drift', 2], ['Peak', 1.5], ['Outro', 1]],
  Breakdown: [['Build', 6], ['Drift', 3], ['Outro', 1]],
  Outro: [['Intro', 5.5], ['Drift', 4.5]],
};

const SECTION_LENGTHS: Record<SectionName, ReadonlyArray<readonly [number, number]>> = {
  Intro: [[16, 2], [32, 1]],
  Drift: [[24, 2], [32, 3], [48, 1]],
  Build: [[16, 3], [24, 2], [32, 1]],
  Peak: [[24, 1], [32, 3], [48, 1.5], [64, 0.5]],
  Breakdown: [[16, 3], [24, 2], [32, 1]],
  Outro: [[16, 3], [24, 1]],
};

/** [start, end] of the section energy curve (before combining with the user energy param). */
const SECTION_ENERGY: Record<SectionName, readonly [number, number]> = {
  Intro: [0.22, 0.38],
  Drift: [0.4, 0.5],
  Build: [0.5, 0.85],
  Peak: [0.85, 0.9],
  Breakdown: [0.3, 0.3],
  Outro: [0.35, 0.12],
};

const DRUM_CAP: Record<SectionName, DrumTier> = {
  Intro: 1,
  Drift: 2,
  Build: 3,
  Peak: 3,
  Breakdown: 1,
  Outro: 1,
};

/** Probability the key changes when entering a section of this name. */
const MODULATE_CHANCE: Record<SectionName, number> = {
  Intro: 0.6,
  Drift: 0.3,
  Build: 0.15,
  Peak: 0.05,
  Breakdown: 0.25,
  Outro: 0,
};

interface StagedLayer {
  layer: LayerId;
  p: number;
  order: number;
  /** chance to keep playing when the layer was already audible at the end of the previous section */
  keep?: number;
}

interface Recipe {
  staged: StagedLayer[];
  firstDelay: number[];
  spacing: number[];
}

const RECIPES: Record<Exclude<SectionName, 'Outro'>, Recipe> = {
  Intro: {
    staged: [
      { layer: 'arp', p: 0.9, order: 1 },
      { layer: 'bass', p: 0.85, order: 1.2 },
      { layer: 'lead', p: 0.5, order: 3 },
      { layer: 'drums', p: 0.2, order: 4 },
    ],
    firstDelay: [4, 8],
    spacing: [4, 4, 8],
  },
  Drift: {
    staged: [
      { layer: 'bass', p: 0.85, order: 1 },
      { layer: 'arp', p: 0.85, order: 1.2 },
      { layer: 'lead', p: 0.75, order: 2.5 },
      { layer: 'drums', p: 0.6, order: 3 },
    ],
    firstDelay: [0, 4],
    spacing: [4, 4, 8],
  },
  Build: {
    staged: [
      { layer: 'bass', p: 0.95, order: 1 },
      { layer: 'arp', p: 0.95, order: 1.2 },
      { layer: 'drums', p: 0.9, order: 2 },
      { layer: 'lead', p: 0.4, order: 3 },
    ],
    firstDelay: [0, 0, 4],
    spacing: [4],
  },
  Peak: {
    staged: [
      { layer: 'bass', p: 1, order: 1 },
      { layer: 'drums', p: 1, order: 1.2 },
      { layer: 'arp', p: 0.95, order: 2 },
      { layer: 'lead', p: 0.9, order: 3 },
    ],
    firstDelay: [0, 0, 4],
    spacing: [4],
  },
  Breakdown: {
    staged: [
      { layer: 'lead', p: 0.75, order: 1, keep: 0.85 },
      { layer: 'arp', p: 0.45, order: 2, keep: 0.5 },
      { layer: 'bass', p: 0.15, order: 3, keep: 0.3 },
    ],
    firstDelay: [0, 4],
    spacing: [4, 8],
  },
};

type LayerState = Record<LayerId, boolean>;

// ---------------------------------------------------------------------------------------------

export class Form {
  readonly seed: number;
  readonly plans: SectionPlan[] = [];
  readonly bank: MotifBank;
  readonly history: MotifHistory;
  private homeTemplates: ReturnType<typeof templatesOf> | null = null;

  constructor(seed: number, params: GenerationParams) {
    this.seed = seed >>> 0;
    this.bank = createMotifBank(this.seed, MOODS[params.mood]);
    this.history = createHistory();
    this.planFirst(params);
  }

  last(): SectionPlan {
    return this.plans[this.plans.length - 1]!;
  }

  private planByIndex(index: number): SectionPlan | undefined {
    if (index < 0) return undefined;
    return this.plans.find((p) => p.index === index);
  }

  next(plan: SectionPlan): SectionPlan | undefined {
    return this.planByIndex(plan.index + 1);
  }

  prev(plan: SectionPlan): SectionPlan | undefined {
    return this.planByIndex(plan.index - 1);
  }

  /** Section containing `bar`, planning forward as needed. */
  sectionForBar(bar: number, params: GenerationParams): SectionPlan {
    while (planEnd(this.last()) <= bar) this.planNext(params);
    // plans are contiguous; binary-ish scan from the end
    for (let i = this.plans.length - 1; i >= 0; i--) if (this.plans[i]!.startBar <= bar) return this.plans[i]!;
    return this.plans[0]!;
  }

  /** Ensure the section after `plan` exists. */
  ensureNext(plan: SectionPlan, params: GenerationParams): SectionPlan {
    let n = this.next(plan);
    while (!n) {
      this.planNext(params);
      n = this.next(plan);
    }
    return n;
  }

  /**
   * Drop completed section plans that ended far behind `renderedThroughBar`.
   * Plans are kept by global `index` (RNG / motifs); only the in-memory list shrinks.
   */
  pruneBehind(renderedThroughBar: number, keepBars = PLAN_KEEP_BARS): void {
    const cutoff = renderedThroughBar - keepBars;
    while (this.plans.length > 2 && planEnd(this.plans[0]!) <= cutoff) this.plans.shift();
  }

  /**
   * A mood change arrived while `plan` is running and its successor is not planned yet: end the section
   * at the next 8-bar boundary that leaves at least LOCK_BARS of already-unrendered music, so the next
   * section (planned in the new mood) arrives within ~8-16 bars instead of up to a minute or more.
   */
  onMoodChange(plan: SectionPlan, renderedThrough: number, params: GenerationParams): void {
    if (this.next(plan) || plan.mood === params.mood) return;
    const minEnd = Math.max(plan.startBar + 16, Math.ceil((renderedThrough + LOCK_BARS) / 8) * 8);
    if (minEnd < planEnd(plan)) {
      plan.lengthBars = minEnd - plan.startBar;
      invalidatePlan(plan);
    }
  }

  // ------------------------------------------------------------------------------------------
  // planning
  // ------------------------------------------------------------------------------------------

  private planFirst(params: GenerationParams): void {
    const mood = MOODS[params.mood];
    const keyRng = stream(this.seed, 'form', 0, 'key');
    const tonic = weightedPick(
      keyRng,
      mood.tonicWeights.map((w, i) => [i, w] as const),
    );
    const scale = weightedPick(keyRng, mood.scales);
    const key: KeySpec = { tonic, scale };
    const lengthRng = stream(this.seed, 'form', 0, 'length');
    let length = chance(lengthRng, 0.6) ? 16 : 32;
    const prog = generateProgression(key, mood, stream(this.seed, 'form', 0, 'prog'));
    length = fitLength(length, prog);
    this.homeTemplates = templatesOf(prog);
    const voicings = voiceLeadLoop(prog.chords, { open: mood.padOpen });
    const bassRoots = bassRootsForChords(prog.chords, null);
    const none = allLayers(() => false);
    const plan: SectionPlan = {
      index: 0,
      name: 'Intro',
      mood: params.mood,
      startBar: 0,
      lengthBars: length,
      curveBars: length,
      key,
      progression: prog,
      voicings,
      bassRoots,
      energy: { from: SECTION_ENERGY.Intro[0], start: SECTION_ENERGY.Intro[0], end: SECTION_ENERGY.Intro[1] },
      layers: this.buildLayers('Intro', length, stream(this.seed, 'form', 0, 'layers'), none, mood),
      joinsPrev: allLayers(() => false),
      leavesAtEnd: allLayers(() => false),
      motifIds: [],
      drumTierCap: capTier(DRUM_CAP.Intro, mood),
      arpFamily: weightedPick(stream(this.seed, 'form', 0, 'arp'), mood.arp.families),
      bassPedal: chance(stream(this.seed, 'form', 0, 'pedal'), mood.bass.pedalChance),
      exitKeyChange: false,
    };
    plan.motifIds = selectMotifs(this.bank, this.history, stream(this.seed, 'form', 0, 'motif'), 0, mood);
    this.plans.push(plan);
  }

  planNext(params: GenerationParams): SectionPlan {
    const A = this.last();
    const idx = A.index + 1;
    const mood = MOODS[params.mood];
    const seed = this.seed;
    const moodChanged = params.mood !== A.mood;

    // --- what kind of section
    const name = pickNextName(A.name, mood, stream(seed, 'form', idx, 'name'), params);
    let length = weightedPick(stream(seed, 'form', idx, 'length'), SECTION_LENGTHS[name]);

    // --- key
    const keyRng = stream(seed, 'form', idx, 'key');
    const allowed = mood.scales.map((s) => s[0]);
    let key = A.key;
    if (moodChanged) {
      if (!allowed.includes(A.key.scale) || chance(keyRng, 0.25)) key = relatedKey(A.key, keyRng, allowed);
    } else if (chance(keyRng, MODULATE_CHANCE[name] * (0.35 + params.variation * 0.9))) {
      key = relatedKey(A.key, keyRng, allowed);
    }
    const keyChanged = !keysEqual(key, A.key);

    // --- progression
    const progRng = stream(seed, 'form', idx, 'prog');
    let prog: Progression;
    if (moodChanged) {
      prog = generateProgression(key, mood, progRng);
    } else {
      const useHome = this.homeTemplates !== null && chance(progRng, 0.25);
      const source = useHome ? this.homeTemplates! : templatesOf(A.progression);
      const base = realizeProgression(key, source);
      const amount = (name === 'Peak' ? 0.6 : 1) * (0.04 + 0.8 * params.variation);
      prog = mutateProgression(base, progRng, amount);
    }
    length = fitLength(length, prog);

    // --- pivot chord at the end of the previous section (modulations happen only at boundaries)
    if (keyChanged && A.lengthBars >= 8) {
      const pivRng = stream(seed, 'form', idx, 'pivot');
      const before = segmentAt(A, A.lengthBars - 3);
      const tpl = findPivotTemplate(A.key, key, pivRng, 2, before.chord.rootPc);
      if (tpl) {
        const chord = buildChord(A.key, tpl);
        const voicing = voiceLeadChord(chord, before.voicing, null, MOODS[A.mood].padOpen);
        A.pivot = {
          chord,
          voicing,
          bassRoot: bassRootMidi(chord.rootPc, before.bassRoot),
          bars: 2,
        };
        invalidatePlan(A);
      }
    }
    const tail = lastSegment(A);

    // --- voicings / bass for the loop, led from the end of A
    const voicings = voiceLeadLoop(prog.chords, { prev: tail.voicing, open: mood.padOpen });
    const bassRoots = bassRootsForChords(prog.chords, tail.bassRoot);

    // --- energy
    const eRng = stream(seed, 'form', idx, 'energy');
    const [e0, e1] = SECTION_ENERGY[name];
    const energy = {
      from: A.energy.end,
      start: clamp01(e0 + jitter(eRng, 0.04)),
      end: clamp01(e1 + jitter(eRng, 0.04)),
    };

    // --- layers
    const prevOn = endState(A);
    const layers = this.buildLayers(name, length, stream(seed, 'form', idx, 'layers'), prevOn, mood);

    const joinsPrev = allLayers((l) => prevOn[l] && inFirstBar(layers[l]));
    const leaves = allLayers((l) => prevOn[l] && !inFirstBar(layers[l]));

    // --- transition style
    let style: TransitionStyle;
    if (keyChanged) style = 'swell';
    else if (name === 'Build' || name === 'Peak' || energy.start - A.energy.end > 0.15) style = 'sweep';
    else if (name === 'Breakdown' || name === 'Outro') style = 'dip';
    else style = 'swell';
    A.exit = style;
    A.exitKeyChange = keyChanged;
    A.leavesAtEnd = leaves;

    const plan: SectionPlan = {
      index: idx,
      name,
      mood: params.mood,
      startBar: planEnd(A),
      lengthBars: length,
      curveBars: length,
      key,
      progression: prog,
      voicings,
      bassRoots,
      energy,
      layers,
      joinsPrev,
      leavesAtEnd: allLayers(() => false),
      motifIds: [],
      drumTierCap: capTier(DRUM_CAP[name], mood),
      arpFamily: pickArpFamily(mood, A.arpFamily, stream(seed, 'form', idx, 'arp')),
      bassPedal: chance(stream(seed, 'form', idx, 'pedal'), mood.bass.pedalChance),
      entry: style,
      exitKeyChange: false,
    };
    plan.motifIds = selectMotifs(this.bank, this.history, stream(seed, 'form', idx, 'motif'), idx, mood);
    this.plans.push(plan);
    return plan;
  }

  // ------------------------------------------------------------------------------------------
  // layer schedule
  // ------------------------------------------------------------------------------------------

  private buildLayers(
    name: SectionName,
    L: number,
    rng: Rng,
    prevOn: LayerState,
    mood: MoodConfig,
  ): Record<LayerId, BarInterval[]> {
    const out = allLayers(() => [] as BarInterval[]);
    out.pad = [[0, L]];
    out.texture = [[0, L]];
    const moodDrums = mood.id === 'space' ? 0.35 : 1;

    if (name === 'Outro') {
      // layers drop out progressively; nothing new enters
      const exitAt: Partial<Record<LayerId, number>> = {
        drums: Math.max(4, Math.floor(L / 4 / 4) * 4),
        lead: Math.max(8, Math.floor(L / 2 / 4) * 4),
        bass: Math.max(8, Math.floor(L / 2 / 4) * 4),
        arp: Math.max(8, Math.floor((L * 0.6) / 4) * 4),
      };
      for (const l of ['drums', 'lead', 'bass', 'arp'] as LayerId[]) {
        const keep = chance(rng, l === 'drums' ? 0.5 : 0.8);
        if (prevOn[l] && keep) out[l] = [[0, Math.min(L, exitAt[l]!)]];
      }
    } else {
      const recipe = RECIPES[name];
      const entries = recipe.staged
        .map((s) => {
          const pAbs = s.layer === 'drums' ? s.p * moodDrums : s.p;
          const present = prevOn[s.layer] ? chance(rng, s.keep ?? 0.9) : chance(rng, pAbs);
          return { layer: s.layer, order: s.order + rng.next() * 0.4, present };
        })
        .filter((e) => e.present)
        .sort((a, b) => a.order - b.order);
      let t = pick(rng, recipe.firstDelay);
      for (const e of entries) {
        if (prevOn[e.layer]) {
          out[e.layer] = [[0, L]];
          continue;
        }
        if (t > L - 4) continue;
        out[e.layer] = [[t, L]];
        t += pick(rng, recipe.spacing);
      }
    }

    // at most two layers may vanish exactly at the boundary; the rest linger for 4/8 more bars
    const leavers = (['drums', 'bass', 'arp', 'lead'] as LayerId[]).filter(
      (l) => prevOn[l] && !inFirstBar(out[l]),
    );
    leavers.slice(2).forEach((l, i) => {
      out[l] = [[0, Math.min(L, 4 * (i + 1))]];
    });
    // keep at least one tonal layer going at bar 0
    if (!inFirstBar(out.pad) && !inFirstBar(out.texture)) out.pad = [[0, L]];
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function inFirstBar(iv: readonly BarInterval[]): boolean {
  return iv.some(([s, e]) => s <= 0 && e > 0);
}

/** Which layers are audible in the final bar of the section (before exit flags are applied). */
export function endState(plan: SectionPlan): LayerState {
  const rel = plan.lengthBars - 1;
  return allLayers((l) => layerOn(plan, l, rel));
}

function capTier(tier: DrumTier, mood: MoodConfig): DrumTier {
  return Math.min(tier, mood.drums.maxTier) as DrumTier;
}

function fitLength(length: number, prog: Progression): number {
  let L = length;
  if (prog.loopBars > 8 && L % prog.loopBars !== 0) {
    L = L + 8 <= 64 ? L + 8 : L - 8;
  }
  return Math.max(16, Math.min(64, L));
}

function pickNextName(prev: SectionName, mood: MoodConfig, rng: Rng, params: GenerationParams): SectionName {
  const weights = NEXT_SECTION[prev].map(([n, w]) => {
    let m = w * (mood.sectionBias[n] ?? 1);
    if ((n === 'Peak' || n === 'Build') && params.energy < 0.25) m *= 0.5;
    if (n === 'Peak' && params.energy > 0.75) m *= 1.4;
    if (n === 'Breakdown' && params.energy < 0.3) m *= 1.3;
    return [n, m] as const;
  });
  return weightedPick(rng, weights);
}

function pickArpFamily(mood: MoodConfig, prev: ArpFamily, rng: Rng): ArpFamily {
  const weights = mood.arp.families.map(([f, w]) => [f, f === prev ? w * 0.4 : w] as const);
  return weightedPick(rng, weights);
}

/** Convenience for tests / debug: scales permitted by a mood. */
export function allowedScales(mood: MoodId): ScaleName[] {
  return MOODS[mood].scales.map((s) => s[0]);
}
