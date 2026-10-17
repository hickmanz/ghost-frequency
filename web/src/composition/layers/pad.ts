/**
 * Pad layer: sustained, voice-led chords. One chord per chord-length; common tones are tied across chord
 * changes (no re-strike), other voices overlap the change slightly. Low complexity drops the colour tones.
 */
import type { NoteEvent } from '@shared/index';
import { PAD_HI } from '../harmony';
import { chordSegments, layerOn, type PlanSegment } from '../plan';
import { jitter, stream } from '../rng';
import { mod12 } from '../theory';
import { BEATS_PER_BAR, energyAt, note, type LayerContext } from './context';

const MAX_RUN_BARS = 8;
const OVERLAP_BEATS = 0.5;

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

/** Decide (deterministically) whether this segment's top voice moves halfway through. */
function splitFor(ctx: LayerContext, k: number, seg: PlanSegment, voices: number[]): SplitInfo | null {
  if (seg.bars < 2 || seg.isPivot || voices.length < 3) return null;
  const { complexity, variation } = ctx.params;
  const p = 0.5 * complexity * (0.35 + 0.65 * variation);
  const rng = stream(ctx.seed, 'pad', 'split', ctx.plan.index, k);
  // Developed mid-passes always try a top-voice move. Full never sets `develop`, so this
  // draw stays in the same place and the same stream position as before.
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
  const segs = chordSegments(plan);
  const out: NoteEvent[] = [];
  const beatOf = (rel: number): number => (plan.startBar + rel) * BEATS_PER_BAR;
  const lo = fromBar * BEATS_PER_BAR;
  const hi = toBar * BEATS_PER_BAR;

  const voices = segs.map((s) => padVoices(s, params.complexity));
  const splits = segs.map((s, k) => splitFor(ctx, k, s, voices[k]!));
  // pitches allowed to tie into the next segment: the split top voice never ties
  const tieSet = segs.map((_, k) => (splits[k] ? voices[k]!.slice(0, -1) : voices[k]!));
  const nextFirst = next ? chordSegments(next)[0] : undefined;
  const nextVoices = nextFirst ? padVoices(nextFirst, params.complexity) : null;
  const voicesAfter = (j: number): number[] | null => (j + 1 < segs.length ? voices[j + 1]! : nextVoices);

  // pitch -> last segment index its currently-sounding note covers
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
      if (!isSplitTop && (coveredThrough.get(p) ?? -1) >= k) continue; // tied from an earlier segment

      let runBars = seg.bars;
      let j = k;
      if (!isSplitTop) {
        while (j + 1 < segs.length && tieSet[j]!.includes(p) && tieSet[j + 1]!.includes(p)) {
          if (runBars + segs[j + 1]!.bars > MAX_RUN_BARS) break;
          runBars += segs[j + 1]!.bars;
          j++;
        }
        coveredThrough.set(p, j);
      }
      if (!inRange) continue;

      let dur: number;
      if (isSplitTop) dur = sp!.splitBar * BEATS_PER_BAR;
      else {
        dur = runBars * BEATS_PER_BAR;
        const after = voicesAfter(j);
        // overlap into the next chord only when the pitch is not re-struck there
        if (after && !after.includes(p)) dur += OVERLAP_BEATS;
      }
      const rng = stream(ctx.seed, 'pad', 'vel', plan.index, k, p);
      let vel = 0.34 + 0.13 * e + jitter(rng, 0.02);
      if (vi === v.length - 1) vel -= 0.03;
      if (vi === 0) vel += 0.02;
      out.push(note('pad', beat, dur, p, vel));
    }

    if (sp) {
      const sBeat = beatOf(seg.startBar + sp.splitBar);
      if (sBeat >= lo && sBeat < hi) {
        const dur = (seg.bars - sp.splitBar) * BEATS_PER_BAR;
        const after = voicesAfter(k);
        const overlap = after && !after.includes(sp.to) ? OVERLAP_BEATS : 0;
        const es = energyAt(ctx, plan.startBar + seg.startBar + sp.splitBar);
        const rng = stream(ctx.seed, 'pad', 'vel', plan.index, k, sp.to);
        out.push(note('pad', sBeat, dur + overlap, sp.to, 0.3 + 0.12 * es + jitter(rng, 0.02)));
      }
    }
  }
  return out;
}
