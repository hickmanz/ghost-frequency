/**

 * Pad layer: sustained, voice-led chords. One chord per chord-length; common tones are tied across chord

 * changes (no re-strike), other voices overlap the change slightly. Low complexity drops the colour tones.

 * Per-song articulation (seeded) adds rhythmic variation without breaking voice-leading tests.

 */

import type { NoteEvent } from '@shared/index';

import { PAD_HI } from '../harmony';

import { chordSegments, layerOn, type PlanSegment } from '../plan';

import { jitter, stream, weightedPick } from '../rng';

import { layerComplexity } from '../steer';

import { clamp01, mod12 } from '../theory';

import { BEATS_PER_BAR, energyAt, note, type LayerContext } from './context';



const MAX_RUN_BARS = 8;

const OVERLAP_BEATS = 0.5;

const PULSE_GAP = 0.04;



export type PadArticulation = 'legato' | 'stagger' | 'pulse' | 'block';



export interface PadStyle {

  articulation: PadArticulation;

}



/** Seeded once per song; stable across render batches. */

export function padStyle(ctx: LayerContext): PadStyle {

  const songKey = ctx.plan.songIndex ?? 0;

  const cacheKey = `pad.style:${songKey}`;

  const hit = ctx.cache.get(cacheKey);

  if (hit) return hit as PadStyle;

  const v = clamp01(ctx.params.variation);

  const rng = stream(ctx.seed, 'pad', 'style', songKey);

  const style: PadStyle = {

    articulation: weightedPick(rng, [

      ['legato', 3 - v * 1.2],

      ['stagger', 1.4 + v],

      ['pulse', 1 + v * 1.1],

      ['block', 0.7 + v * 0.9],

    ]),

  };

  ctx.cache.set(cacheKey, style);

  return style;

}



/** Voices actually played for a segment given complexity (colour tones dropped when low). */

export function padVoices(seg: PlanSegment, complexity: number): number[] {

  const v = seg.voicing.slice().sort((a, b) => a - b);

  if (complexity >= 0.35 || v.length <= 3) return v;

  const ext = new Set(seg.chord.intervals.slice(3).map((i) => mod12(i)));

  const core = v.filter((p) => !ext.has(mod12(p - seg.chord.rootPc)));

  return core.length >= 3 ? core : v;

}



interface SplitInfo {

  splitBar: number;

  to: number;

}



function voiceOnset(style: PadStyle, vi: number): number {

  if (style.articulation === 'stagger') return vi * 0.25;

  return 0;

}



function pushPadNotes(

  out: NoteEvent[],

  style: PadStyle,

  beat: number,

  dur: number,

  midi: number,

  vel: number,

  vi: number,

): void {

  const onset = voiceOnset(style, vi);

  const start = beat + onset;

  let remaining = Math.max(0.05, dur - onset);

  if (style.articulation !== 'pulse' || remaining <= BEATS_PER_BAR + 0.01) {

    out.push(note('pad', start, remaining, midi, vel));

    return;

  }

  let t = start;

  while (remaining > 0.05) {

    const chunk = Math.min(BEATS_PER_BAR, remaining);

    out.push(note('pad', t, Math.max(0.05, chunk - PULSE_GAP), midi, vel));

    t += BEATS_PER_BAR;

    remaining -= BEATS_PER_BAR;

  }

}



/** Decide (deterministically) whether this segment's top voice moves halfway through. */

function splitFor(

  ctx: LayerContext,

  k: number,

  seg: PlanSegment,

  voices: number[],

  style: PadStyle,

): SplitInfo | null {

  if (seg.bars < 2 || seg.isPivot || voices.length < 3) return null;

  const complexity = layerComplexity(ctx.params);

  const { variation } = ctx.params;

  let p = 0.5 * complexity * (0.35 + 0.65 * variation);

  if (style.articulation === 'pulse' || style.articulation === 'block') p *= 1.25;

  const rng = stream(ctx.seed, 'pad', 'split', ctx.plan.index, k);

  const dev = ctx.develop;

  const pass =

    dev && dev.sourceLoop > 0

      ? Math.min(dev.passCount - 1, Math.floor(Math.max(0, seg.startBar) / dev.sourceLoop))

      : null;

  const forced = pass !== null && dev!.passCount >= 3 && pass > 0 && pass < dev!.passCount - 1;

  if (!forced && rng.next() >= p) return null;

  const top = voices[voices.length - 1]!;

  const splitBar = seg.bars >= 4 ? 2 : 1;

  let best: number | null = null;

  let bestScore = Infinity;

  for (let cand = top - 5; cand <= top + 5; cand++) {

    if (Math.abs(cand - top) < 2 || cand > PAD_HI + 3) continue;

    if (!seg.chord.pcs.includes(mod12(cand))) continue;

    if (voices.some((v, i) => i < voices.length - 1 && Math.abs(v - cand) < 2)) continue;

    if (voices.includes(cand)) continue;

    const score = Math.abs(cand - top) - (cand > top ? 0.1 : 0);

    if (score < bestScore) {

      bestScore = score;

      best = cand;

    }

  }

  return best === null ? null : { splitBar, to: best };

}



export function renderPad(ctx: LayerContext): NoteEvent[] {

  const { plan, next, fromBar, toBar, params } = ctx;

  const style = padStyle(ctx);

  const segs = chordSegments(plan);

  const out: NoteEvent[] = [];

  const beatOf = (rel: number): number => (plan.startBar + rel) * BEATS_PER_BAR;

  const lo = fromBar * BEATS_PER_BAR;

  const hi = toBar * BEATS_PER_BAR;

  const crossChordTies = style.articulation !== 'block';



  const cx = layerComplexity(params);

  const voices = segs.map((s) => padVoices(s, cx));

  const splits = segs.map((s, k) => splitFor(ctx, k, s, voices[k]!, style));

  const tieSet = segs.map((_, k) => (splits[k] ? voices[k]!.slice(0, -1) : voices[k]!));

  const nextFirst = next ? chordSegments(next)[0] : undefined;

  const nextVoices = nextFirst ? padVoices(nextFirst, cx) : null;

  const voicesAfter = (j: number): number[] | null => (j + 1 < segs.length ? voices[j + 1]! : nextVoices);



  const coveredThrough = new Map<number, number>();



  for (let k = 0; k < segs.length; k++) {

    const seg = segs[k]!;

    if (!layerOn(plan, 'pad', seg.startBar)) continue;

    const sp = splits[k];

    const v = voices[k]!;

    const beat = beatOf(seg.startBar);

    const inRange = beat >= lo && beat < hi;

    const e = energyAt(ctx, plan.startBar + seg.startBar);



    for (let vi = 0; vi < v.length; vi++) {

      const p = v[vi]!;

      const isSplitTop = sp !== null && vi === v.length - 1;

      if (!isSplitTop && (coveredThrough.get(p) ?? -1) >= k) continue;



      let runBars = seg.bars;

      let j = k;

      if (!isSplitTop && crossChordTies) {

        while (j + 1 < segs.length && tieSet[j]!.includes(p) && tieSet[j + 1]!.includes(p)) {

          if (runBars + segs[j + 1]!.bars > MAX_RUN_BARS) break;

          runBars += segs[j + 1]!.bars;

          j++;

        }

        coveredThrough.set(p, j);

      } else if (!isSplitTop) {

        coveredThrough.set(p, k);

      }

      if (!inRange) continue;



      let dur: number;

      if (isSplitTop) dur = sp!.splitBar * BEATS_PER_BAR;

      else {

        dur = runBars * BEATS_PER_BAR;

        const after = voicesAfter(j);

        if (after && !after.includes(p)) dur += OVERLAP_BEATS;

      }

      const rng = stream(ctx.seed, 'pad', 'vel', plan.index, k, p);

      let vel = 0.34 + 0.13 * e + jitter(rng, 0.02);

      if (vi === v.length - 1) vel -= 0.03;

      if (vi === 0) vel += 0.02;

      pushPadNotes(out, style, beat, dur, p, vel, vi);

    }



    if (sp) {

      const sBeat = beatOf(seg.startBar + sp.splitBar);

      if (sBeat >= lo && sBeat < hi) {

        const dur = (seg.bars - sp.splitBar) * BEATS_PER_BAR;

        const after = voicesAfter(k);

        const overlap = after && !after.includes(sp.to) ? OVERLAP_BEATS : 0;

        const es = energyAt(ctx, plan.startBar + seg.startBar + sp.splitBar);

        const rng = stream(ctx.seed, 'pad', 'vel', plan.index, k, sp.to);

        const topVi = v.length - 1;

        pushPadNotes(out, style, sBeat, dur + overlap, sp.to, 0.3 + 0.12 * es + jitter(rng, 0.02), topVi);

      }

    }

  }

  return out;

}

