/**
 * Lead layer: sparse, atmospheric phrases built from the piece's motif bank. Phrases are 1-2 bars and
 * answer each other over 8-bar blocks (call at bar 0, response at bar 4, rare fills at 2/6). Strong beats and
 * long notes are fitted to the current chord; notes always stay inside the scale (or the chord's own tones).
 */
import type { NoteEvent } from '@shared/index';
import type { SectionName } from '../moods';
import {
  getMotif,
  transposeToChord,
  truncate,
  varyMotif,
  type Motif,
} from '../motifs';
import { layerOn, segmentAt } from '../plan';
import { chance, jitter, stream } from '../rng';
import { clashesWithChord, mod12, snapToScale, type RealChord } from '../theory';
import { BEATS_PER_BAR, energyAt, liveMood, note, type LayerContext } from './context';

const SECTION_LEAD_BASE: Record<SectionName, number> = {
  Intro: 0.4,
  Drift: 0.62,
  Build: 0.55,
  Peak: 0.85,
  Breakdown: 0.72,
  Outro: 0.35,
};

const MAX_PHRASE_NOTES = 9;

/** Move a pitch to a nearby chord tone (inside the scale) when it would clash on a strong/long note. */
export function fitToChord(midi: number, chord: RealChord, force: boolean): number {
  const pc = mod12(midi);
  if (chord.pcs.includes(pc)) return midi;
  const harsh = clashesWithChord(pc, chord.pcs);
  if (!harsh && !force) return midi;
  let best = midi;
  let bestDist = Infinity;
  for (let d = -3; d <= 3; d++) {
    if (d === 0) continue;
    const cand = midi + d;
    if (!chord.pcs.includes(mod12(cand))) continue;
    const dist = Math.abs(d) + (d < 0 ? 0.05 : 0);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

function phraseProbability(ctx: LayerContext, startRel: number, slotMult: number): number {
  const mood = liveMood(ctx);
  const e = energyAt(ctx, ctx.plan.startBar + startRel);
  const p = SECTION_LEAD_BASE[ctx.plan.name] * mood.lead.activity * (0.45 + 0.9 * e) * slotMult;
  return Math.min(0.92, p);
}

function pickMotif(ctx: LayerContext, rng: { next(): number }, secondaryChance: number): Motif {
  const ids = ctx.plan.motifIds;
  const useSecondary = ids.length > 1 && rng.next() < secondaryChance;
  return getMotif(ctx.bank, useSecondary ? ids[1]! : ids[0]!);
}

/** Build (and cache) the notes of one phrase slot. */
function buildPhrase(ctx: LayerContext, block: number, off: number): NoteEvent[] {
  const { plan, params } = ctx;
  const startRel = block * 8 + off;
  const devKey = ctx.develop
    ? `:${plan.progression.chords.map((c) => c.label).join('.')}:${plan.lengthBars}:${plan.pivot?.bars ?? 0}`
    : '';
  const cacheKey = `lead:${plan.index}:${block}:${off}${devKey}`;
  const cached = ctx.cache.get(cacheKey) as NoteEvent[] | undefined;
  if (cached) return cached;

  const result: NoteEvent[] = [];
  const store = (): NoteEvent[] => {
    ctx.cache.set(cacheKey, result);
    return result;
  };
  if (startRel >= plan.lengthBars - 2) return store();
  if (!layerOn(plan, 'lead', startRel)) return store();

  const slotMult = off === 0 ? 1 : off === 4 ? 0.85 : 0.28;
  if ((off === 2 || off === 6) && (params.complexity < 0.45 || energyAt(ctx, plan.startBar + startRel) < 0.55)) {
    return store();
  }
  const rng = stream(ctx.seed, 'lead', plan.index, block, off);
  if (rng.next() >= phraseProbability(ctx, startRel, slotMult)) return store();

  // choose + vary motif (the very first statement in a section is the plain theme)
  const callRng = stream(ctx.seed, 'lead', plan.index, block, 'call');
  const base = pickMotif(ctx, callRng, 0.25);
  let m: Motif;
  if (block === 0 && off === 0) m = base;
  else if (off === 4) {
    // response: shortened / displaced version of the call
    m = varyMotif(base, rng, Math.max(0.5, params.variation));
    if (m === base && chance(rng, 0.6)) m = truncate(base, Math.max(2, Math.ceil(base.notes.length * 0.6)));
  } else m = varyMotif(base, rng, params.variation * 0.8);

  const mood = liveMood(ctx);
  const seg0 = segmentAt(plan, startRel);
  const real = transposeToChord(m, {
    key: plan.key,
    chord: seg0.chord,
    register: mood.lead.register,
    center: mood.lead.center,
  });

  const startBeat = (plan.startBar + startRel) * BEATS_PER_BAR;
  let count = 0;
  for (const n of real) {
    if (count >= MAX_PHRASE_NOTES) break;
    const noteRel = startRel + Math.floor(n.t / BEATS_PER_BAR);
    if (noteRel >= plan.lengthBars - 1) continue;
    const seg = segmentAt(plan, noteRel);
    let midi = n.midi;
    const longish = n.dur >= 1 || n.strong;
    if (seg.chord !== seg0.chord || longish) midi = fitToChord(midi, seg.chord, n.strong && n.dur >= 1);
    // stay inside the scale unless it is a tone of the sounding chord
    if (!seg.chord.pcs.includes(mod12(midi))) midi = snapToScale(plan.key, midi);
    const e = energyAt(ctx, plan.startBar + noteRel);
    let vel = 0.38 + 0.12 * e + jitter(rng, 0.02);
    if (n.strong) vel += 0.03;
    if (n.dur <= 0.5) vel -= 0.04;
    result.push(note('lead', startBeat + n.t, n.dur * 1.02, midi, vel));
    count++;
  }
  return store();
}

export function renderLead(ctx: LayerContext): NoteEvent[] {
  const { plan, fromBar, toBar } = ctx;
  const fromRel = fromBar - plan.startBar;
  const toRel = toBar - plan.startBar;
  const lo = fromBar * BEATS_PER_BAR;
  const hi = toBar * BEATS_PER_BAR;
  const out: NoteEvent[] = [];
  const firstBlock = Math.max(0, Math.floor((fromRel - 2) / 8));
  const lastBlock = Math.floor((toRel - 1) / 8);
  for (let b = firstBlock; b <= lastBlock; b++) {
    for (const off of [0, 2, 4, 6]) {
      const start = b * 8 + off;
      if (start >= toRel || start + 2 <= fromRel) continue;
      for (const n of buildPhrase(ctx, b, off)) if (n.beat >= lo && n.beat < hi) out.push(n);
    }
  }
  return out;
}
