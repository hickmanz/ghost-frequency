/**
 * Texture layer: very long drone notes (root + fifth, re-triggered every 8 bars at most) plus slowly drifting
 * 'texture.noise' / 'filter.texture' automation.
 */
import type { AutomationEvent, NoteEvent } from '@shared/index';
import { chordSegments, type SectionPlan } from '../plan';
import { stream } from '../rng';
import { clamp, mod12 } from '../theory';
import { BEATS_PER_BAR, energyAt, liveMood, note, type LayerContext } from './context';

export const DRONE_BARS = 8;

/** Choose the drone root for an 8-bar block: the tonic unless it grinds against the block's chords. */
export function droneRootPc(plan: SectionPlan, fromRel: number, toRel: number): number {
  const tonic = plan.key.tonic;
  const candidates = [tonic, tonic + 7, tonic + 5].map(mod12);
  let best = candidates[0]!;
  let bestScore = Infinity;
  const segs = chordSegments(plan);
  candidates.forEach((cand, i) => {
    let score = i === 0 ? 0 : 0.8;
    for (const s of segs) {
      const a = Math.max(s.startBar, fromRel);
      const b = Math.min(s.startBar + s.bars, toRel);
      if (b <= a) continue;
      const bars = b - a;
      for (const pc of s.chord.pcs) {
        const d = mod12(pc - cand);
        if (d === 1 || d === 11) score += bars * 1.0;
        else if (d === 6) score += bars * 0.7;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  });
  return best;
}

export function renderTextureNotes(ctx: LayerContext): NoteEvent[] {
  const { plan, fromBar, toBar } = ctx;
  const out: NoteEvent[] = [];
  const mood = liveMood(ctx);
  for (const [s, eRaw] of plan.layers.texture) {
    const e = Math.min(eRaw, plan.lengthBars);
    for (let r = s; r < e; r += DRONE_BARS) {
      const bar = plan.startBar + r;
      if (bar < fromBar || bar >= toBar) continue;
      const endRel = Math.min(r + DRONE_BARS, e);
      const pc = droneRootPc(plan, r, endRel);
      const root = 36 + mod12(pc);
      const dur = (endRel - r) * BEATS_PER_BAR;
      const en = energyAt(ctx, bar);
      const level = clamp(mood.texture.drone, 0.3, 1.3);
      const v = (0.26 + 0.1 * (1 - en)) * level;
      const beat = bar * BEATS_PER_BAR;
      out.push(note('texture', beat, dur, root, v));
      out.push(note('texture', beat, dur, root + 7, v * 0.72));
    }
  }
  return out;
}

export function renderTextureAutomation(ctx: LayerContext): AutomationEvent[] {
  const { fromBar, toBar } = ctx;
  const out: AutomationEvent[] = [];
  const mood = liveMood(ctx);
  for (let bar = fromBar; bar < toBar; bar++) {
    if (bar % 8 !== 0) continue;
    const rng = stream(ctx.seed, 'texture', 'auto', bar / 8);
    const u = rng.next();
    const u2 = rng.next();
    const e = energyAt(ctx, bar);
    const noise = clamp(mood.texture.noise * (0.55 + 0.9 * u) * (1 - 0.3 * e), 0.05, 0.85);
    const filt = clamp(0.28 + 0.42 * u2 + 0.12 * e, 0.1, 0.95);
    const ramp = bar === 0 ? 0 : 28;
    out.push({ kind: 'automation', target: 'texture.noise', beat: bar * BEATS_PER_BAR, value: noise, rampBeats: ramp });
    out.push({ kind: 'automation', target: 'filter.texture', beat: bar * BEATS_PER_BAR, value: filt, rampBeats: ramp });
  }
  return out;
}
