/**
 * Bass layer: roots / fifths / octaves in the sub register (MIDI 28..48). Low energy = long roots on chord
 * changes, mid = syncopated eighths, high = driving eighth/sixteenth pulse. The last beat of a chord may
 * approach the next root with a scale tone. Optional tonic pedal (dark / space) when consonant.
 */
import type { NoteEvent } from '@shared/index';
import { BASS_HI, BASS_LO, bassRootMidi } from '../harmony';
import { chordSegments, layerOn, segmentIndexAt, type PlanSegment } from '../plan';
import { chance, int, jitter, stream } from '../rng';
import { midiToScaleIndex, mod12, scaleIndexToMidi, type RealChord } from '../theory';
import { layerComplexity, resolvedSteer } from '../steer';
import { BEATS_PER_BAR, energyAt, liveMood, note, type LayerContext } from './context';

type Role = 'r' | 'o' | 'f' | 't';
type Hit = readonly [beat: number, dur: number, role: Role];

const SYNC_PATTERNS: ReadonlyArray<readonly Hit[]> = [
  [[0, 1, 'r'], [1.5, 0.5, 'r'], [2, 1, 'r'], [3.5, 0.5, 'o']],
  [[0, 1.5, 'r'], [1.5, 0.5, 'r'], [2.5, 0.5, 'f'], [3, 1, 'r']],
  [[0, 0.75, 'r'], [0.75, 0.75, 'r'], [1.5, 0.5, 'o'], [2.5, 0.5, 'r'], [3, 1, 'f']],
  [[0, 1, 'r'], [1, 0.5, 'r'], [2, 1, 'r'], [3, 0.5, 'f'], [3.5, 0.5, 'r']],
];

const DRIVE_PATTERNS: ReadonlyArray<readonly Hit[]> = [
  [[0, 0.5, 'r'], [0.5, 0.5, 'r'], [1, 0.5, 'o'], [1.5, 0.5, 'r'], [2, 0.5, 'r'], [2.5, 0.5, 'r'], [3, 0.5, 'o'], [3.5, 0.5, 'r']],
  [[0, 0.5, 'r'], [0.5, 0.5, 'o'], [1, 0.5, 'r'], [1.5, 0.5, 'o'], [2, 0.5, 'r'], [2.5, 0.5, 'o'], [3, 0.5, 'r'], [3.5, 0.5, 'f']],
  [[0, 0.5, 'r'], [0.5, 0.5, 'r'], [1, 0.5, 'o'], [1.5, 0.5, 'r'], [2, 0.5, 'r'], [2.5, 0.5, 'r'], [3, 0.5, 'f'], [3.5, 0.5, 'o']],
];

const DRIVE_16: readonly Hit[] = [
  [0, 0.25, 'r'], [0.25, 0.25, 'r'], [0.5, 0.25, 'o'], [0.75, 0.25, 'r'],
  [1, 0.25, 'r'], [1.25, 0.25, 'r'], [1.5, 0.25, 'o'], [1.75, 0.25, 'r'],
  [2, 0.25, 'r'], [2.25, 0.25, 'r'], [2.5, 0.25, 'o'], [2.75, 0.25, 'r'],
  [3, 0.25, 'r'], [3.25, 0.25, 'r'], [3.5, 0.25, 'o'], [3.75, 0.25, 'f'],
];

/** Tonic pedal is only used while no chord tone sits a semitone/tritone from the tonic. */
export function pedalConsonant(tonicPc: number, chord: RealChord): boolean {
  return chord.pcs.every((p) => {
    const d = mod12(p - tonicPc);
    return d !== 1 && d !== 6 && d !== 11;
  });
}

function rootFor(ctx: LayerContext, seg: PlanSegment): number {
  const { plan } = ctx;
  if (plan.bassPedal && !seg.isPivot && pedalConsonant(plan.key.tonic, seg.chord)) {
    return bassRootMidi(plan.key.tonic, seg.bassRoot);
  }
  return seg.bassRoot;
}

function fifthOf(chord: RealChord): number {
  return chord.intervals.find((i) => i === 6 || i === 7 || i === 8) ?? 7;
}

function thirdOf(chord: RealChord): number | null {
  return chord.intervals.find((i) => i === 3 || i === 4) ?? null;
}

/** Octave-shift into the bass register (never clamp: clamping changes the pitch class). */
function fitBass(m: number): number {
  let x = m;
  while (x > BASS_HI) x -= 12;
  while (x < BASS_LO) x += 12;
  return x;
}

function foldNear(m: number, target: number): number {
  let x = m;
  while (x - target > 6) x -= 12;
  while (target - x > 6) x += 12;
  while (x < BASS_LO) x += 12;
  while (x > BASS_HI) x -= 12;
  return x;
}

export function renderBass(ctx: LayerContext): NoteEvent[] {
  const { plan, next, fromBar, toBar, params } = ctx;
  const segs = chordSegments(plan);
  const out: NoteEvent[] = [];
  const mood = liveMood(ctx);

  for (let bar = fromBar; bar < toBar; bar++) {
    const rel = bar - plan.startBar;
    if (!layerOn(plan, 'bass', rel)) continue;
    const si = segmentIndexAt(plan, rel);
    const seg = segs[si]!;
    const barInChord = rel - seg.startBar;
    const isFirst = barInChord === 0;
    const isLast = barInChord === seg.bars - 1;
    const R = rootFor(ctx, seg);
    const fifth = fitBass(R + fifthOf(seg.chord));
    // high roots have no room for an octave above: jump down instead (or to the fifth below) so 'o' still moves
    const octave = R + 12 <= BASS_HI ? R + 12 : R - 12 >= BASS_LO ? R - 12 : fitBass(R + fifthOf(seg.chord) - 12);
    const thirdIv = thirdOf(seg.chord);
    const third = thirdIv === null ? fifth : fitBass(R + thirdIv);
    const roleMidi = (r: Role): number => (r === 'r' ? R : r === 'o' ? octave : r === 't' ? third : fifth);

    const e = Math.min(1, energyAt(ctx, bar) * (0.75 + 0.35 * mood.bass.activity));
    const tier = e < 0.36 ? 'long' : e < 0.68 ? 'sync' : 'drive';
    const rng = stream(ctx.seed, 'bass', 'bar', plan.index, rel);
    const patRng = stream(ctx.seed, 'bass', 'pat', plan.index, Math.floor(rel / 8));
    const baseVel = 0.56 + 0.2 * e;

    // approach note into the next chord's root (not while holding a pedal)
    let passing: number | null = null;
    const nextSeg: PlanSegment | undefined = si + 1 < segs.length ? segs[si + 1] : next ? chordSegments(next)[0] : undefined;
    const pedalNow = plan.bassPedal && !seg.isPivot && pedalConsonant(plan.key.tonic, seg.chord);
    if (isLast && nextSeg && !pedalNow) {
      const passRng = stream(ctx.seed, 'bass', 'pass', plan.index, rel);
      if (passRng.next() < 0.2 + 0.5 * layerComplexity(params)) {
        const nextR = bassRootMidi(nextSeg.chord.rootPc, R);
        if (nextR !== R) {
          const key = si + 1 < segs.length ? plan.key : (next ?? plan).key;
          const idx = midiToScaleIndex(key, nextR);
          const below = nextR > R;
          const approach = foldNear(scaleIndexToMidi(key, idx + (below ? -1 : 1)), nextR);
          if (approach !== nextR && approach !== R && Math.abs(approach - R) <= 9) passing = approach;
        }
      }
    }
    const lastBeatLimit = passing !== null ? 3.5 : BEATS_PER_BAR;

    const hits: Array<{ beat: number; dur: number; midi: number; vel: number }> = [];
    if (tier === 'long') {
      const retrigger = isFirst || (barInChord === 2 && seg.bars >= 4);
      if (retrigger) {
        const hold = Math.min(2, seg.bars - barInChord);
        const coversLast = barInChord + hold >= seg.bars;
        const dur = hold * BEATS_PER_BAR - (coversLast && passing !== null ? 0.5 : 0.25);
        hits.push({ beat: 0, dur, midi: R, vel: baseVel + (isFirst ? 0.04 : -0.04) });
      }
    } else {
      let pat: readonly Hit[];
      if (tier === 'sync') pat = SYNC_PATTERNS[Math.floor(patRng.next() * SYNC_PATTERNS.length)]!;
      else if (e > 0.88 && layerComplexity(params) > 0.62 && chance(patRng, 0.35)) pat = DRIVE_16;
      else pat = DRIVE_PATTERNS[Math.floor(patRng.next() * DRIVE_PATTERNS.length)]!;
      const cx = layerComplexity(params);
      const flip = chance(rng, params.variation * 0.3) ? int(rng, 1, 6) : -1;
      const useThird = tier === 'sync' && !pedalNow && thirdIv !== null && chance(rng, 0.15 + 0.35 * cx);
      // turnaround on the last bar of a 4-bar phrase: octave + fifth pickup over the final beat
      const fill = passing === null && rel % 4 === 3 && chance(rng, 0.3 + 0.4 * cx);
      const fillFrom = fill ? 3 : lastBeatLimit;
      pat.forEach(([beat, dur, role], i) => {
        if (beat >= fillFrom) return;
        let r: Role = role;
        if (i === flip && role === 'r' && beat > 0) r = 'o';
        if (useThird && role === 'f' && beat % 1 !== 0) r = 't';
        const accent = beat === 0 ? 0.12 : beat % 1 === 0 ? 0.03 : beat % 0.5 === 0 ? -0.05 : -0.09;
        const end = Math.min(beat + dur * 0.92, fillFrom);
        hits.push({ beat, dur: end - beat, midi: roleMidi(r), vel: baseVel + accent + jitter(rng, 0.03) });
      });
      if (fill) {
        hits.push({ beat: 3, dur: 0.46, midi: octave, vel: baseVel + 0.02 });
        hits.push({ beat: 3.5, dur: 0.46, midi: fifth === octave ? R : fifth, vel: baseVel - 0.03 });
      }
    }
    if (passing !== null) hits.push({ beat: 3.5, dur: 0.5, midi: passing, vel: baseVel - 0.04 });

    hits.sort((a, b) => a.beat - b.beat);
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]!;
      let dur = h.dur;
      const nxt = hits[i + 1];
      if (nxt) dur = Math.min(dur, nxt.beat - h.beat);
      if (dur < 0.1) continue;
      out.push(note('bass', bar * BEATS_PER_BAR + h.beat, dur, h.midi, Math.min(0.9, h.vel)));
    }
  }
  return out;
}
