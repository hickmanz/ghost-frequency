/**
 * Drum layer: synthwave groove families (four-on-floor, backbeat, half-time, electro, breakbeat, gated, shuffle,
 * minimal). Each song plays one family; each section picks a kick pattern + hat style inside it; each bar may drift
 * (add/drop a kick, drop half the hats), fill, or stop. Density tiers still gate how much plays:
 *   0 none | 1 kick + light hats | 2 the groove | 3 groove + ghosts, open hats, fills, extras
 * Timing follows the song swing (Swing knob) plus a small per-family looseness; snares sit slightly behind.
 */
import type { NoteEvent } from '@shared/index';
import { DRUM } from '@shared/index';
import type { DrumStyle, DrumTier } from '../moods';
import { layerOn, type SectionPlan } from '../plan';
import { chance, jitter, pick, stream, type Rng } from '../rng';
import { clamp, clamp01 } from '../theory';
import { layerComplexity, resolvedSteer } from '../steer';
import { swingAmount, swingShift } from '../swing';
import { BEATS_PER_BAR, energyAt, liveMood, note, type LayerContext } from './context';

export type HatStyle = 'offbeat' | 'eighths' | 'sixteenths' | 'shaker' | 'ride';

/** Tier actually played at a given effective energy (capped by section + live mood). */
export function drumTierFor(plan: SectionPlan, e: number, moodMax: DrumTier, capBonus = 0): DrumTier {
  const byEnergy: DrumTier = e < 0.22 ? 0 : e < 0.45 ? 1 : e < 0.7 ? 2 : 3;
  const cap = Math.min(3, plan.drumTierCap + capBonus);
  return Math.min(byEnergy, cap, moodMax) as DrumTier;
}

/** High user energy lifts the section drum cap in Intro/Drift; Breakdown/Outro keep their dip. */
function drumCapBonus(plan: SectionPlan, energy: number): number {
  if (plan.name !== 'Intro' && plan.name !== 'Drift') return 0;
  return energy > 0.8 ? 2 : energy > 0.6 ? 1 : 0;
}

/** 16-step kick patterns per family (x = hit). */
const FAMILY_KICKS: Record<DrumStyle, readonly string[]> = {
  fourfloor: ['x...x...x...x...', 'x...x...x...x...', 'x...x...x...x..x', 'x...x...x.x.x...'],
  backbeat: ['x.......x.......', 'x.......x.x.....', 'x......x..x.....', 'x.........x.....', 'x.x.....x.......'],
  halftime: ['x.........x.....', 'x......x.....x..', 'x..........x....', 'x.x.........x...'],
  electro: ['x......x..x.....', 'x..x..x...x.....', 'x.....x...x..x..', 'x..x......x.x...'],
  breakbeat: ['x.x.......x..x..', 'x......x.xx.....', 'x..x...x..x.....', 'x.........x.x...', 'x.....x.x.....x.'],
  gated: ['x.......x.......', 'x.......x..x....', 'x......xx.......'],
  shuffle: ['x.......x.......', 'x.....x.x.......', 'x.......x..x....'],
  minimal: ['x...............', 'x.......x.......', 'x.........x.....'],
};

const FAMILY_HATS: Record<DrumStyle, readonly HatStyle[]> = {
  fourfloor: ['offbeat', 'offbeat', 'sixteenths', 'eighths'],
  backbeat: ['eighths', 'sixteenths', 'shaker'],
  halftime: ['sixteenths', 'eighths', 'ride'],
  electro: ['sixteenths', 'eighths'],
  breakbeat: ['sixteenths', 'eighths', 'ride'],
  gated: ['eighths', 'offbeat'],
  shuffle: ['eighths', 'shaker', 'ride'],
  minimal: ['shaker', 'offbeat', 'ride'],
};

/** Timing looseness (beats, +/-) per family. */
const LOOSE: Record<DrumStyle, number> = {
  fourfloor: 0.003,
  backbeat: 0.006,
  halftime: 0.008,
  electro: 0.004,
  breakbeat: 0.014,
  gated: 0.004,
  shuffle: 0.012,
  minimal: 0.008,
};

/** Overall level per family (the soft ones sit back). */
const LEVEL: Partial<Record<DrumStyle, number>> = { minimal: 0.82, shuffle: 0.92 };

/** GM toms: 50 high, 48 hi-mid, 47 low-mid, 45 low, 43 floor (= DRUM.tom), 41 low floor. */
export const TOM_NOTES = [41, 43, 45, 47, 48, 50] as const;
const TOMS_LONG = [50, 47, 45, DRUM.tom] as const;
const TOMS_SHORT = [45, 41] as const;
const TOM_HIGH = 48;

const steps = (pattern: string): number[] => [...pattern].flatMap((c, i) => (c === 'x' ? [i] : []));

interface SectionGroove {
  kick: number[];
  hats: HatStyle;
  ghostSteps: number[];
  openHat: boolean;
  /** clap layered on the backbeat */
  clap: boolean;
}

function sectionGroove(seed: number, plan: SectionPlan, family: DrumStyle): SectionGroove {
  const rng = stream(seed, 'drums', 'groove', plan.index, family);
  return {
    kick: steps(pick(rng, FAMILY_KICKS[family])),
    hats: pick(rng, FAMILY_HATS[family]),
    ghostSteps: [7, 10, 15].filter(() => chance(rng, 0.35)),
    openHat: chance(rng, family === 'fourfloor' ? 0.75 : family === 'gated' ? 0.5 : 0.3),
    clap: family === 'gated' || family === 'electro' ? chance(rng, 0.8) : chance(rng, 0.35),
  };
}

type Add = (step: number, pitch: number, vel: number, dur: number, lag?: number) => void;

export function renderDrums(ctx: LayerContext): NoteEvent[] {
  const { plan, fromBar, toBar, params } = ctx;
  const out: NoteEvent[] = [];
  const mood = liveMood(ctx);
  const family: DrumStyle = plan.drumStyle ?? mood.drums.style;
  const g = sectionGroove(ctx.seed, plan, family);
  const exitDrop = plan.leavesAtEnd.drums;
  const steer = resolvedSteer(params);
  const cx = layerComplexity(params);
  const variation = clamp01(params.variation * 0.6 + steer.motion * 0.4);
  const swing = swingAmount(plan, params);
  const loose = LOOSE[family] * (0.6 + steer.feel * 0.8) * (1.08 - steer.sync * 0.12);
  const level = LEVEL[family] ?? 1;
  const snareLag = 0.004 + steer.feel * 0.012;

  for (let bar = fromBar; bar < toBar; bar++) {
    const rel = bar - plan.startBar;
    if (!layerOn(plan, 'drums', rel)) continue;
    if (exitDrop && rel === plan.lengthBars - 1) continue; // drop-out bar
    const e = Math.min(1, energyAt(ctx, bar) * (0.62 + 0.42 * steer.busy));
    const tier = drumTierFor(plan, e, mood.drums.maxTier, drumCapBonus(plan, params.energy));
    if (tier === 0) continue;
    const rng = stream(ctx.seed, 'drums', 'bar', plan.index, rel);
    const barStart = bar * BEATS_PER_BAR;
    // wide dynamics: quiet bars are really quiet, peaks hit hard
    const force = 0.45 + 0.5 * e;
    const add: Add = (step, pitch, vel, dur, lag = 0) => {
      const pos = step * 0.25;
      const t = pos + swingShift(pos, swing) + lag + (step === 0 ? 0 : jitter(rng, loose));
      const beat = barStart + clamp(t, 0, BEATS_PER_BAR - 0.02);
      const v = vel * force * level * (0.88 + rng.next() * 0.24);
      out.push(note('drums', beat, dur, pitch, clamp(v, 0.04, 1)));
    };

    const isLastBar = rel === plan.lengthBars - 1;
    const isSongEnd = isLastBar && plan.exit === 'sweep';

    // a "stop" bar before a new section: downbeat only, then silence (not on drop-outs; they already breathe)
    if (isLastBar && !exitDrop && tier >= 2 && rel > 0 && chance(rng, isSongEnd ? 0.4 : 0.06 + variation * 0.18)) {
      add(0, DRUM.kick, 0.95, 0.25);
      if (chance(rng, 0.5)) add(0, DRUM.crash, 0.4, 1.5);
      continue;
    }

    // ---- fills
    const lastOf8 = rel % 8 === 7;
    const lastOf4 = rel % 4 === 3;
    const dropNext = exitDrop && rel === plan.lengthBars - 2;
    let fill = false;
    if (tier >= 2) {
      if (lastOf8 && chance(rng, 0.45 + 0.4 * cx)) fill = true;
      else if (tier === 3 && lastOf4 && chance(rng, 0.12 + 0.2 * cx)) fill = true;
    }
    if (isSongEnd || dropNext) fill = true;
    const fillStart = fill ? (tier === 3 || isLastBar || dropNext ? 12 : 14) : 16;

    // ---- kick
    let kick = g.kick;
    if (tier === 1) kick = kick.filter((s) => s === 0 || s === 8 || s === 10).slice(0, rel % 2 === 1 ? 2 : 1);
    if (tier === 3 && e > 0.8 && family !== 'minimal' && family !== 'fourfloor' && chance(rng, 0.4)) kick = [...kick, 13];
    if (rel > 0 && tier >= 2 && chance(rng, variation * 0.6)) {
      const extra = pick(rng, [3, 6, 7, 9, 11, 13, 14]);
      kick = chance(rng, 0.5)
        ? [...kick.filter((s) => s !== extra), extra]
        : kick.filter((s, i) => s === 0 || i !== kick.length - 1);
    }
    for (const s of kick) {
      if (s !== 0 && s >= fillStart) continue;
      const accent = s === 0 ? 1 : s % 4 === 0 ? 0.88 : 0.7;
      add(s, DRUM.kick, (tier === 1 ? 0.78 : 0.95) * accent, 0.25);
    }

    // ---- backbeat
    if (tier >= 2) renderBackbeat(family, g, add, rng, tier, fillStart, snareLag, rel);
    else if (family === 'minimal' || family === 'halftime') add(12, DRUM.rim, 0.45, 0.1, snareLag);

    if (tier === 3 && (family === 'breakbeat' || family === 'halftime' || family === 'backbeat' || family === 'shuffle')) {
      for (const s of g.ghostSteps) {
        if (s < fillStart && chance(rng, 0.3 + cx * 0.5)) add(s, DRUM.snare, 0.17, 0.1, snareLag);
      }
    }

    // ---- hats
    renderHats(g, add, rng, tier, e, fill ? fillStart : 16, rel > 0 && chance(rng, variation * 0.18));

    // ---- fill content
    if (fill) addFill(add, rng, tier, fillStart, family);

    // ---- crash at a section arrival
    if (tier >= 2 && rel === 0 && plan.entry === 'sweep' && chance(rng, 0.45)) add(0, DRUM.crash, 0.42, 1.6);
  }
  return out;
}

function renderBackbeat(
  family: DrumStyle,
  g: SectionGroove,
  add: Add,
  rng: Rng,
  tier: DrumTier,
  fillStart: number,
  lag: number,
  rel: number,
): void {
  const at = (s: number, pitch: number, vel: number, dur = 0.2, l = lag): void => {
    if (s < fillStart) add(s, pitch, vel, dur, l);
  };
  const soft = tier === 2 ? 0.82 : 1;
  switch (family) {
    case 'halftime':
      at(8, DRUM.snare, 0.92 * soft);
      if (g.clap) at(8, DRUM.clap, 0.5 * soft);
      if (tier === 3 && chance(rng, 0.5)) at(12, DRUM.rim, 0.38);
      break;
    case 'minimal':
      at(4, DRUM.rim, 0.62 * soft, 0.1);
      at(12, DRUM.rim, 0.68 * soft, 0.1);
      if (tier === 3 && rel % 2 === 1) at(14, DRUM.rim, 0.3, 0.1);
      break;
    case 'electro':
      at(4, DRUM.clap, 0.85 * soft, 0.2, lag * 0.4);
      at(12, DRUM.clap, 0.9 * soft, 0.2, lag * 0.4);
      at(12, DRUM.snare, 0.45 * soft);
      if (tier === 3 && chance(rng, 0.4)) at(pick(rng, [7, 11, 15]), DRUM.rim, 0.42);
      break;
    case 'gated':
      // big 80s snare: snare + clap stacked, hit hard
      at(4, DRUM.snare, 1.0 * soft, 0.35);
      at(12, DRUM.snare, 1.0 * soft, 0.35);
      if (g.clap) {
        at(4, DRUM.clap, 0.6 * soft);
        at(12, DRUM.clap, 0.62 * soft);
      }
      break;
    case 'breakbeat':
      at(4, DRUM.snare, 0.88 * soft);
      at(12, DRUM.snare, 0.92 * soft);
      if (tier === 3 && chance(rng, 0.35)) at(pick(rng, [7, 10, 15]), DRUM.snare, 0.48);
      break;
    case 'shuffle':
      at(4, DRUM.snare, 0.78 * soft);
      at(12, DRUM.snare, 0.82 * soft);
      if (g.clap) at(12, DRUM.rim, 0.4 * soft, 0.1);
      break;
    default:
      // fourfloor / backbeat
      at(4, DRUM.snare, 0.84 * soft);
      at(12, DRUM.snare, 0.9 * soft, 0.2, lag + 0.003);
      if (g.clap) at(12, DRUM.clap, 0.48 * soft);
  }
}

function renderHats(
  g: SectionGroove,
  add: Add,
  rng: Rng,
  tier: DrumTier,
  e: number,
  hatEnd: number,
  dropHalf: boolean,
): void {
  // tier 1 keeps it light: offbeats / shaker only, some skipped
  const style: HatStyle = tier === 1 ? (g.hats === 'shaker' || g.hats === 'ride' ? g.hats : 'offbeat') : g.hats;
  const thin = tier === 1 ? 0.35 : tier === 2 ? 0.12 : 0.03;
  const busy = tier === 3 ? e : e * 0.6;
  const openLift = tier >= 2 && hatEnd > 14 && g.openHat && style !== 'shaker' && style !== 'ride';
  const vScale = tier === 1 ? 0.7 : 1;

  if (style === 'ride') {
    for (const s of [0, 4, 8, 12]) {
      if (s >= hatEnd || (dropHalf && s < 8)) continue;
      add(s, DRUM.ride, (s % 8 === 4 ? 0.5 : 0.4) * vScale, 0.6);
      // swung skip note before beats 2 and 4
      if (tier === 3 && (s === 4 || s === 12) && s + 3 < hatEnd && chance(rng, 0.7)) add(s + 3, DRUM.ride, 0.28, 0.4);
    }
    return;
  }

  for (let s = 0; s < hatEnd; s++) {
    if (dropHalf && s < 8) continue;
    const onBeat = s % 4 === 0;
    const offEighth = s % 4 === 2;
    if (offEighth && chance(rng, thin) && s !== 14) continue;
    switch (style) {
      case 'eighths':
        if (s % 2 === 0) add(s, DRUM.hatClosed, (onBeat ? 0.4 : 0.3) * vScale, 0.08);
        else if (busy > 0.6 && chance(rng, (busy - 0.6) * 1.4)) add(s, DRUM.hatClosed, 0.14, 0.06);
        break;
      case 'sixteenths':
        if (s % 2 === 0) add(s, DRUM.hatClosed, (onBeat ? 0.38 : offEighth ? 0.32 : 0.24) * vScale, 0.07);
        else if (chance(rng, 0.15 + busy * 0.75)) add(s, DRUM.hatClosed, 0.11 + rng.next() * 0.1, 0.05);
        break;
      case 'offbeat':
        if (offEighth) {
          if (s === 14 && openLift && chance(rng, 0.7)) add(s, DRUM.hatOpen, 0.36, 0.45);
          else add(s, DRUM.hatClosed, 0.38 * vScale, 0.08);
        } else if (tier === 3 && busy > 0.5 && s % 2 === 1 && chance(rng, busy * 0.35)) add(s, DRUM.hatClosed, 0.12, 0.05);
        break;
      case 'shaker':
        if (busy > 0.3 || s % 2 === 0) add(s, DRUM.shaker, (offEighth ? 0.44 : s % 2 === 0 ? 0.3 : 0.2) * vScale, 0.08);
        break;
      default:
        break;
    }
  }
  if (openLift && style !== 'offbeat' && e > 0.45 && chance(rng, 0.5)) add(14, DRUM.hatOpen, 0.32, 0.45);
}

function addFill(add: Add, rng: Rng, tier: DrumTier, start: number, family: DrumStyle): void {
  if (tier === 2 && start >= 14) {
    add(14, DRUM.snare, 0.4, 0.15);
    add(15, DRUM.snare, 0.55, 0.15);
    return;
  }
  const tomish = family === 'gated' || family === 'electro' ? 0.7 : 0.45;
  if (!chance(rng, tomish)) {
    const vels = [0.3, 0.38, 0.46, 0.55, 0.64, 0.74];
    for (let s = start, i = 0; s < 16; s++, i++) add(s, DRUM.snare, vels[Math.min(i, vels.length - 1)]! * 0.95, 0.15);
    return;
  }
  // descending tom run on the GM tom notes (the instrument tunes by midi)
  const run = start <= 12 ? [12, 13, 14, 15] : [14, 15];
  const toms = start <= 12 ? TOMS_LONG : TOMS_SHORT;
  run.forEach((s, i) => add(s, toms[i]!, 0.55 + 0.08 * i, 0.3));
  if (start <= 10) add(10, TOM_HIGH, 0.45, 0.3);
}
