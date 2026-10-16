/**
 * Drum layer: restrained electronic drums in density tiers
 *   0 none | 1 soft kick + hats | 2 half-time (snare/clap on beat 3, optional four-on-floor kick) |
 *   3 fuller (four-on-floor, backbeat, open hats, fills)
 * Fills only on the last bar of 4/8-bar groups, ghost hats, seeded velocity humanisation (no timing jitter).
 */
import type { NoteEvent } from '@shared/index';
import { DRUM } from '@shared/index';
import type { DrumTier } from '../moods';
import { layerOn, type SectionPlan } from '../plan';
import { chance, jitter, stream, type Rng } from '../rng';
import { clamp } from '../theory';
import { BEATS_PER_BAR, energyAt, liveMood, note, type LayerContext } from './context';

/** Tier actually played at a given effective energy (capped by section + live mood). */
export function drumTierFor(plan: SectionPlan, e: number, moodMax: DrumTier): DrumTier {
  const byEnergy: DrumTier = e < 0.22 ? 0 : e < 0.45 ? 1 : e < 0.7 ? 2 : 3;
  return Math.min(byEnergy, plan.drumTierCap, moodMax) as DrumTier;
}

interface Hit {
  step: number;
  pitch: number;
  vel: number;
  dur: number;
}

export function renderDrums(ctx: LayerContext): NoteEvent[] {
  const { plan, fromBar, toBar, params } = ctx;
  const out: NoteEvent[] = [];
  const mood = liveMood(ctx);
  const style = mood.drums.style;
  const groove = stream(ctx.seed, 'drums', 'groove', plan.index);
  const extraKick = chance(groove, 0.5);
  const kickPickup = chance(groove, 0.5);
  const ghostSnareStep = chance(groove, 0.5) ? 7 : 15;
  const exitDrop = plan.leavesAtEnd.drums;

  for (let bar = fromBar; bar < toBar; bar++) {
    const rel = bar - plan.startBar;
    if (!layerOn(plan, 'drums', rel)) continue;
    if (exitDrop && rel === plan.lengthBars - 1) continue; // drop-out bar
    const e = energyAt(ctx, bar);
    const tier = drumTierFor(plan, e, mood.drums.maxTier);
    if (tier === 0) continue;
    const rng = stream(ctx.seed, 'drums', 'bar', plan.index, rel);
    const cx = params.complexity;
    const dyn = 0.72 + 0.4 * e;
    const soft = style === 'soft' || style === 'minimal' ? 0.85 : 1;
    const hits: Hit[] = [];
    const add = (step: number, pitch: number, vel: number, dur: number): void => {
      hits.push({ step, pitch, vel: clamp(vel * dyn * soft + jitter(rng, 0.035), 0.04, 1), dur });
    };

    // ---- fills
    const lastOf8 = rel % 8 === 7;
    const lastOf4 = rel % 4 === 3;
    const isLastBar = rel === plan.lengthBars - 1;
    const dropNext = exitDrop && rel === plan.lengthBars - 2;
    let fill = false;
    if (tier >= 2) {
      if (lastOf8 && chance(rng, 0.55 + 0.4 * cx)) fill = true;
      else if (tier === 3 && lastOf4 && chance(rng, 0.15 + 0.2 * cx)) fill = true;
    }
    if (isLastBar && plan.exit === 'sweep') fill = true;
    if (dropNext) fill = true;
    const fillStart = fill ? (tier === 3 || isLastBar || dropNext ? 12 : 14) : 16;

    // ---- kick
    const kickVel = (s: number, v: number): void => {
      if (s < fillStart || s === 0) add(s, DRUM.kick, v, 0.25);
    };
    if (tier === 1) {
      kickVel(0, 0.78);
      if (extraKick && rel % 2 === 1) kickVel(8, 0.6);
    } else if (tier === 2) {
      if (style === 'fourfloor') {
        kickVel(0, 0.85);
        kickVel(4, 0.5);
        kickVel(8, 0.75);
        kickVel(12, 0.5);
      } else {
        kickVel(0, 0.85);
        kickVel(10, 0.62);
        if (kickPickup && rel % 2 === 1) kickVel(6, 0.5);
      }
    } else {
      kickVel(0, 0.9);
      kickVel(4, 0.72);
      kickVel(8, 0.84);
      kickVel(12, 0.72);
      if (kickPickup && rel % 4 === 3 && fillStart > 14) kickVel(14, 0.5);
    }

    // ---- snare / clap
    if (tier === 2) {
      add(8, DRUM.snare, 0.7, 0.2);
      if (style !== 'soft') add(8, DRUM.clap, 0.5, 0.2);
    } else if (tier === 3) {
      if (style === 'halftime') {
        add(8, DRUM.snare, 0.78, 0.2);
        add(8, DRUM.clap, 0.55, 0.2);
      } else {
        for (const s of [4, 12]) {
          if (s < fillStart) {
            add(s, DRUM.snare, 0.74, 0.2);
            add(s, DRUM.clap, 0.5, 0.2);
          }
        }
      }
      if (cx > 0.55 && fillStart > ghostSnareStep && chance(rng, 0.3)) add(ghostSnareStep, DRUM.snare, 0.16, 0.12);
    }

    // ---- hats
    const hatEnd = fill ? fillStart : 16;
    if (tier === 1) {
      for (let s = 0; s < hatEnd; s += 2) add(s, DRUM.hatClosed, s % 4 === 2 ? 0.3 : 0.2, 0.1);
      if (cx > 0.4) for (const s of [3, 11]) if (s < hatEnd && chance(rng, 0.25 + 0.3 * cx)) add(s, DRUM.hatClosed, 0.1, 0.08);
    } else if (tier === 2) {
      for (let s = 0; s < hatEnd; s += 2) add(s, DRUM.hatClosed, s % 4 === 2 ? 0.34 : 0.24, 0.1);
      const ghostP = 0.12 + 0.4 * cx;
      for (let s = 1; s < hatEnd; s += 2) if (chance(rng, ghostP)) add(s, DRUM.hatClosed, 0.1 + 0.06 * rng.next(), 0.07);
      if (hatEnd > 14 && rel % 2 === 1 && chance(rng, 0.45)) add(14, DRUM.hatOpen, 0.34, 0.5);
    } else {
      const openSteps = new Set(rel % 2 === 0 ? [6, 14] : [14]);
      for (let s = 0; s < hatEnd; s += 2) {
        if (openSteps.has(s) && chance(rng, 0.45 + 0.4 * cx)) add(s, DRUM.hatOpen, 0.36, 0.45);
        else add(s, DRUM.hatClosed, s % 4 === 0 ? 0.3 : 0.38, 0.1);
      }
      const ghostP = 0.25 + 0.4 * cx;
      for (let s = 1; s < hatEnd; s += 2) if (chance(rng, ghostP)) add(s, DRUM.hatClosed, 0.1 + 0.1 * rng.next(), 0.07);
    }

    // ---- fill content
    if (fill) addFill(add, rng, tier, fillStart);

    // ---- crash after a fill / at a section arrival
    const arrival = rel === 0 && plan.entry === 'sweep';
    if (tier >= 2 && ((rel > 0 && rel % 8 === 0 && chance(rng, 0.5)) || (arrival && chance(rng, 0.85)))) {
      add(0, DRUM.crash, 0.46, 2);
    }

    for (const h of hits) {
      out.push(note('drums', bar * BEATS_PER_BAR + h.step * 0.25, h.dur, h.pitch, h.vel));
    }
  }
  return out;
}

function addFill(
  add: (step: number, pitch: number, vel: number, dur: number) => void,
  rng: Rng,
  tier: DrumTier,
  start: number,
): void {
  if (tier === 2 && start >= 14) {
    add(14, DRUM.snare, 0.4, 0.15);
    add(15, DRUM.snare, 0.55, 0.15);
    return;
  }
  const variant = rng.next() < 0.5 ? 'snare' : 'tom';
  if (variant === 'snare') {
    const vels = [0.3, 0.38, 0.46, 0.55, 0.64, 0.74];
    for (let s = start, i = 0; s < 16; s++, i++) add(s, DRUM.snare, vels[Math.min(i, vels.length - 1)]! * 0.95, 0.15);
  } else {
    const steps = start <= 12 ? [12, 13, 14, 15] : [14, 15];
    steps.forEach((s, i) => add(s, i % 2 === 0 ? DRUM.tom : DRUM.snare, 0.45 + 0.1 * i, 0.2));
    if (start <= 10) add(10, DRUM.tom, 0.4, 0.2);
  }
}
