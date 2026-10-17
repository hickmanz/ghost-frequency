/**
 * Bar-level arrangement for the Developed engine, applied after the shared layer renderers.
 * Full never calls this. Notes already produced for pass 0 stay, except where a call-slot
 * thin or a response-bar motif quote rewrites the arp (and, on one calm pass, the bass and drums).
 */
import type { GenerationParams, MusicEvent, NoteEvent } from '@shared/index';
import { DRUM } from '@shared/index';
import { arpPool } from '../composition/layers/arp';
import { BEATS_PER_BAR, note } from '../composition/layers/context';
import { getMotif, transposeToChord } from '../composition/motifs';
import type { MotifBank } from '../composition/motifs';
import { effectiveEnergy, layerOn, segmentAt, type SectionPlan } from '../composition/plan';
import { BASS_HI, BASS_LO } from '../composition/harmony';

const SWING_BEATS = 0.045;
const DUCK_GAIN = 0.75;

export interface ArrangeInput {
  events: MusicEvent[];
  plan: SectionPlan;
  sourceLoop: number;
  passCount: number;
  params: GenerationParams;
  bank: MotifBank;
  fromBar: number;
  toBar: number;
}

function passOf(rel: number, sourceLoop: number, passCount: number): number {
  if (sourceLoop <= 0) return 0;
  return Math.min(passCount - 1, Math.floor(Math.max(0, rel) / sourceLoop));
}

function foldBass(midi: number): number {
  let x = midi;
  while (x > BASS_HI) x -= 12;
  while (x < BASS_LO) x += 12;
  return x;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function isHat(midi: number): boolean {
  return midi === DRUM.hatClosed || midi === DRUM.hatOpen;
}

function onDownbeat(beatInBar: number): boolean {
  const nearestBeat = Math.round(beatInBar);
  return Math.abs(beatInBar - nearestBeat) < 0.06 && nearestBeat % 1 === 0;
}

function offEighth(beatInBar: number): boolean {
  const frac = beatInBar - Math.floor(beatInBar);
  return Math.abs(frac - 0.5) < 0.04;
}

export function arrangeDevelopEvents(input: ArrangeInput): MusicEvent[] {
  const { plan, sourceLoop, passCount, params, bank, fromBar, toBar } = input;
  const motifId = plan.motifIds[0];
  const motif = motifId === undefined ? null : getMotif(bank, motifId);

  const kept: MusicEvent[] = [];
  const notes: NoteEvent[] = [];
  for (const e of input.events) {
    if (e.kind === 'note') notes.push(e);
    else kept.push(e);
  }

  const byBar = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const bar = Math.floor(n.beat / BEATS_PER_BAR);
    const list = byBar.get(bar);
    if (list) list.push(n);
    else byBar.set(bar, [n]);
  }

  const calm = plan.name === 'Drift' || plan.name === 'Breakdown' || plan.name === 'Intro' || plan.name === 'Outro';
  const longPass = passCount >= 2 && calm ? 1 : -1;
  const hatPass = passCount >= 2 && calm ? 1 : -1;
  const kickGapPass = passCount >= 2 && !calm ? 1 : -1;

  const outNotes: NoteEvent[] = [];
  const bars: number[] = [];
  for (let bar = fromBar; bar < toBar; bar++) bars.push(bar);

  for (const bar of bars) {
    const rel = bar - plan.startBar;
    const group = byBar.get(bar) ?? [];
    const pass = passOf(rel, sourceLoop, passCount);
    const quote = pass % 2 === 1 || rel % 8 === 4;
    const call = rel % 8 === 0;
    const leadBeats = group.filter((n) => n.layer === 'lead').map((n) => n.beat);
    const leadHere = leadBeats.length > 0;
    const seg = rel >= 0 && rel < plan.lengthBars ? segmentAt(plan, rel) : null;
    const energy = effectiveEnergy(plan, rel, params.energy);

    let arp = group.filter((n) => n.layer === 'arp');
    const rest = group.filter((n) => n.layer !== 'arp' && n.layer !== 'bass' && n.layer !== 'drums');
    let bass = group.filter((n) => n.layer === 'bass');
    let drums = group.filter((n) => n.layer === 'drums');

    if (call && leadHere) arp = arp.filter((n) => onDownbeat(n.beat - bar * BEATS_PER_BAR));

    if (quote && motif && seg && arp.length > 0) {
      const pool = arpPool(seg.chord.rootPc, seg.chord.intervals, params.complexity);
      if (pool.length >= 3 && motif.notes.length > 0) {
        const ordered = arp.slice().sort((a, b) => a.beat - b.beat);
        const steps = motif.notes;
        let idx = mod(Math.round(steps[0]?.step ?? 0), pool.length);
        ordered.forEach((n, i) => {
          const step = steps[i % steps.length]!.step;
          const prev = steps[(i - 1 + steps.length) % steps.length]!.step;
          if (i > 0) {
            const delta = Math.sign(step - prev);
            idx = mod(idx + (delta === 0 ? 1 : delta), pool.length);
          }
          n.midi = pool[idx]!;
        });
      }
      if (leadHere) arp = arp.filter((n) => !leadBeats.some((b) => Math.abs(b - n.beat) < 0.08));
    }

    if (pass === longPass && seg && layerOn(plan, 'bass', rel)) {
      const root = seg.bassRoot;
      const quoteBass = quote && motif;
      let approach: number | null = null;
      if (quoteBass) {
        const realized = transposeToChord(motif, {
          key: plan.key,
          chord: seg.chord,
          register: [BASS_LO, BASS_HI],
          center: 40,
        });
        const last = realized[realized.length - 1];
        if (last) {
          const folded = foldBass(last.midi);
          if (folded !== root) approach = folded;
        }
      }
      const dur = approach !== null ? 3.4 : 3.85;
      const vel = bass.length > 0 ? bass.reduce((s, n) => s + n.vel, 0) / bass.length : 0.62;
      bass = [note('bass', bar * BEATS_PER_BAR, dur, root, Math.min(0.9, vel))];
      if (approach !== null) bass.push(note('bass', bar * BEATS_PER_BAR + 3.5, 0.45, approach, vel * 0.9));
    }

    if (pass === hatPass) drums = drums.filter((n) => isHat(n.midi));
    if (pass === kickGapPass && rel % sourceLoop < 2) drums = drums.filter((n) => n.midi !== DRUM.kick);

    if (energy < 0.55) {
      const swing = (n: NoteEvent): void => {
        if ((n.layer === 'arp' || (n.layer === 'drums' && isHat(n.midi))) && offEighth(n.beat - bar * BEATS_PER_BAR)) {
          n.beat += SWING_BEATS;
        }
      };
      arp.forEach(swing);
      drums.forEach(swing);
    }

    const bellish = plan.name === 'Drift' || plan.name === 'Breakdown';
    const bell: NoteEvent[] = [];
    if (bellish && quote && motif && seg) {
      const realized = transposeToChord(motif, {
        key: plan.key,
        chord: seg.chord,
        register: [72, 88],
        center: 79,
      });
      const longs = realized.filter((n) => n.dur >= 1);
      const picked = (longs.length > 0 ? longs : realized.slice(0, 1)).slice(0, 2);
      for (const n of picked) {
        const beat = bar * BEATS_PER_BAR + n.t;
        if (beat >= (bar + 1) * BEATS_PER_BAR) continue;
        bell.push(note('bell', beat, Math.min(n.dur, 2.5), n.midi, 0.28 + 0.06 * (1 - energy)));
      }
    }

    outNotes.push(...rest, ...arp, ...bass, ...drums, ...bell);
  }

  // Notes whose bar had no entry still need to be kept. byBar covers every note, so outNotes is complete.

  const ducks: MusicEvent[] = [];
  for (const n of outNotes) {
    if (n.layer !== 'drums' || n.midi !== DRUM.kick) continue;
    for (const target of ['duck.pad', 'duck.texture'] as const) {
      ducks.push({ kind: 'automation', target, beat: n.beat, value: DUCK_GAIN, rampBeats: 0 });
      ducks.push({ kind: 'automation', target, beat: n.beat + 0.12, value: 1, rampBeats: 0.35 });
    }
  }

  return [...kept, ...ducks, ...outNotes];
}
