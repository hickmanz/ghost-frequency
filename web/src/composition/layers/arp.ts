/**
 * Arp layer: pattern library over chord tones (two octaves), gated for breathing, with per-bar mutation
 * controlled by `variation`. Rate / accents follow energy and complexity.
 */
import type { NoteEvent } from '@shared/index';
import type { ArpFamily } from '../moods';
import { layerOn, segmentAt } from '../plan';
import { chance, int, jitter, stream, type Rng } from '../rng';
import { clamp, mod12 } from '../theory';
import { feelMul, layerComplexity, resolvedSteer } from '../steer';
import { BEATS_PER_BAR, energyAt, liveMood, note, type LayerContext } from './context';

const ARP_MIN = 57;
const ARP_MAX = 86;

/** Chord tones the arp may use, ascending across two octaves from a root placed at ~MIDI 57..68. */
export function arpPool(rootPc: number, intervals: readonly number[], complexity: number): number[] {
  const count = complexity < 0.3 ? 3 : complexity < 0.65 ? 4 : 5;
  const tones = intervals.slice(0, Math.max(3, count));
  const rootBase = ARP_MIN + mod12(rootPc - ARP_MIN);
  const pool = new Set<number>();
  for (const iv of tones) {
    for (const oct of [0, 12]) {
      const p = rootBase + iv + oct;
      if (p >= ARP_MIN && p <= ARP_MAX) pool.add(p);
    }
  }
  return Array.from(pool).sort((a, b) => a - b);
}

interface Pattern {
  /** pool index per step (null = rest) */
  idx: Array<number | null>;
  /** steps per bar (8 or 16) */
  steps: number;
}

const DOTTED_ONSETS = [0, 3, 6, 8, 11, 14];

function ping(i: number, n: number): number {
  if (n <= 1) return 0;
  const cycle = 2 * (n - 1);
  const k = i % cycle;
  return k < n ? k : cycle - k;
}

/** Build the base index pattern of a family for a bar. */
export function basePattern(family: ArpFamily, steps: number, poolSize: number, phase: number): Pattern {
  const span = Math.min(poolSize, 8);
  const idx: Array<number | null> = new Array(steps).fill(null);
  switch (family) {
    case 'up':
      for (let i = 0; i < steps; i++) idx[i] = i % span;
      break;
    case 'updown':
      for (let i = 0; i < steps; i++) idx[i] = ping(i, span);
      break;
    case 'broken': {
      const cell = [0, 2, 1, 3];
      for (let i = 0; i < steps; i++) {
        const shift = (Math.floor(i / 4) + phase) % Math.max(1, span - 3);
        idx[i] = Math.min(span - 1, cell[i % 4]! + (span > 4 ? shift : 0));
      }
      break;
    }
    case 'skip':
      for (let i = 0; i < steps; i++) idx[i] = ping(i * 2, span);
      break;
    case 'pedal':
      for (let i = 0; i < steps; i++) idx[i] = i % 2 === 0 ? 0 : 1 + ((Math.floor(i / 2) + phase) % Math.max(1, span - 1));
      break;
    case 'dotted': {
      if (steps === 16) {
        DOTTED_ONSETS.forEach((s, n) => {
          idx[s] = ping(n + phase, Math.min(span, 5));
        });
      } else {
        for (let i = 0; i < steps; i++) idx[i] = ping(i, span);
      }
      break;
    }
  }
  return { idx, steps };
}

/** Small bar-to-bar mutations (swap, neighbour step, octave lift, dropped note). */
function mutate(p: Pattern, rng: Rng, poolSize: number, count: number): void {
  for (let n = 0; n < count; n++) {
    const filled: number[] = [];
    p.idx.forEach((v, i) => {
      if (v !== null) filled.push(i);
    });
    if (filled.length < 3) return;
    const i = filled[int(rng, 1, filled.length - 1)]!;
    const op = int(rng, 0, 3);
    const cur = p.idx[i]!;
    if (op === 0) {
      const j = filled[Math.max(0, filled.indexOf(i) - 1)]!;
      const t = p.idx[j]!;
      p.idx[j] = cur;
      p.idx[i] = t;
    } else if (op === 1) p.idx[i] = clamp(cur + (chance(rng, 0.5) ? 1 : -1), 0, poolSize - 1);
    else if (op === 2) p.idx[i] = Math.min(poolSize - 1, cur + 3);
    else p.idx[i] = null;
  }
}

export function renderArp(ctx: LayerContext): NoteEvent[] {
  const { plan, fromBar, toBar, params } = ctx;
  const out: NoteEvent[] = [];
  const mood = liveMood(ctx);
  for (let bar = fromBar; bar < toBar; bar++) {
    const rel = bar - plan.startBar;
    if (!layerOn(plan, 'arp', rel)) continue;
    const seg = segmentAt(plan, rel);
    const e = energyAt(ctx, bar);
    const steer = resolvedSteer(params);
    const cx = layerComplexity(params);
    const feel = feelMul(steer.feel);
    const pool = arpPool(seg.chord.rootPc, seg.chord.intervals, cx);
    if (pool.length < 3) continue;

    const block = Math.floor(rel / 8);
    const blockRng = stream(ctx.seed, 'arp', 'block', plan.index, block);
    const barRng = stream(ctx.seed, 'arp', 'bar', plan.index, block, rel % 4);

    // rate: 16ths when the music is energetic/complex, else 8ths
    const drive = 0.6 * e + 0.4 * cx + 0.2 * (mood.arp.density - 0.5);
    const baseSteps = drive > 0.6 || plan.arpFamily === 'dotted' ? 16 : 8;
    const steps = Math.min(32, Math.max(4, Math.round(baseSteps * feel)));
    const stepLen = BEATS_PER_BAR / steps;

    // family: mostly the section family, sometimes a neighbour for variety (per 8-bar block)
    let family: ArpFamily = plan.arpFamily;
    const sync = steer.sync;
    if (chance(blockRng, 0.35 * params.variation * (1 - sync * 0.85))) {
      const alt: ArpFamily[] = ['up', 'updown', 'broken', 'skip'];
      family = alt[int(blockRng, 0, alt.length - 1)]!;
    }
    const pat = basePattern(family, steps, pool.length, Math.floor(rel / 4) % 3);

    // per-bar mutation; turnaround bar (last of 4) mutates more
    const turnaround = rel % 4 === 3;
    const pm = Math.min(0.95, params.variation * 0.6 * (turnaround ? 1.6 : 1));
    if (chance(barRng, pm)) mutate(pat, barRng, pool.length, params.variation > 0.7 ? 2 : 1);

    // gating for breathing (never on beats) + sparser at low energy
    const gate = ((1 - e) * 0.24 + 0.04 + (turnaround ? 0.1 : 0)) * (1.15 - sync * 0.65);
    const beatStepEvery = steps / 4;
    const baseVel = 0.26 + 0.2 * e + 0.05 * cx;
    const octLift = e > 0.7 && turnaround && chance(barRng, 0.5);
    const gateLen = 0.55 + 0.3 * (1 - e);

    for (let s = 0; s < steps; s++) {
      const ix = pat.idx[s];
      if (ix === null || ix === undefined) continue;
      const onBeat = s % beatStepEvery === 0;
      if (!onBeat && chance(barRng, gate)) continue;
      let midi = pool[Math.min(ix, pool.length - 1)]!;
      if (octLift && s >= steps - Math.max(2, steps / 4) && midi + 12 <= ARP_MAX + 6) midi += 12;
      let vel = baseVel;
      if (onBeat) vel += 0.1;
      else if (s % (beatStepEvery / 2 || 1) === 0) vel += 0.04;
      vel += jitter(barRng, 0.025);
      out.push(note('arp', bar * BEATS_PER_BAR + s * stepLen, stepLen * gateLen, midi, Math.min(0.72, vel)));
    }
  }
  return out;
}
