/**
 * Dev-only harness (not wired into the app): hand-written Am - F - C - G test song so the sound can be auditioned
 * without the composer. Usage from the browser console / a scratch page (after a user gesture):
 *
 *   const r = createRenderer();
 *   await playTestProgression(r, { mood: 'nostalgic' });
 */
import { DRUM, SCHEMA_VERSION, type EventBatch, type MoodId, type MusicEvent } from '@shared/index';
import type { AudioRenderer } from './types';

interface Chord {
  root: number; // bass root midi
  pad: number[];
  arp: number[]; // arp pool (one octave above pad)
  lead: Array<[beatInBar: number, dur: number, midi: number]>;
}

const CHORDS: Chord[] = [
  { root: 45, pad: [57, 60, 64, 71], arp: [69, 72, 76, 79], lead: [[0, 2, 76], [2, 1, 74], [3, 1, 72]] }, // Am9-ish
  { root: 41, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76], lead: [[0, 1.5, 72], [1.5, 0.5, 69], [2, 2, 77]] }, // Fmaj7
  { root: 48, pad: [55, 60, 64, 67], arp: [67, 72, 76, 79], lead: [[0, 2, 79], [2, 1, 76], [3, 1, 74]] }, // C
  { root: 43, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79], lead: [[0, 3, 74], [3, 1, 71]] }, // G
];

function barEvents(barIndex: number): MusicEvent[] {
  const c = CHORDS[barIndex % CHORDS.length]!;
  const b0 = barIndex * 4;
  const ev: MusicEvent[] = [];

  // pad chord (held for the bar, rings into the next)
  for (const m of c.pad) ev.push({ kind: 'note', layer: 'pad', beat: b0, durBeats: 4, midi: m, vel: 0.7 });

  // bass: root pulse in 8ths with a little syncopation
  for (const [off, dur] of [[0, 1.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]] as const) {
    ev.push({ kind: 'note', layer: 'bass', beat: b0 + off, durBeats: dur * 0.9, midi: c.root, vel: off === 0 ? 0.9 : 0.7 });
  }

  // arp: 16ths up-down over the chord pool
  const order = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 1, 3];
  order.forEach((ix, i) => {
    ev.push({ kind: 'note', layer: 'arp', beat: b0 + i * 0.25, durBeats: 0.2, midi: c.arp[ix]!, vel: 0.45 + 0.35 * ((i % 4) === 0 ? 1 : 0.4) });
  });

  // drums: kick 1 & 3 (+ pickup), snare+clap on 2 & 4, 8th hats, open hat before the downbeat
  for (const k of [0, 2, 2.75]) ev.push({ kind: 'note', layer: 'drums', beat: b0 + k, durBeats: 0.25, midi: DRUM.kick, vel: k === 2.75 ? 0.55 : 0.9 });
  for (const s of [1, 3]) {
    ev.push({ kind: 'note', layer: 'drums', beat: b0 + s, durBeats: 0.25, midi: DRUM.snare, vel: 0.85 });
    ev.push({ kind: 'note', layer: 'drums', beat: b0 + s, durBeats: 0.25, midi: DRUM.clap, vel: 0.5 });
  }
  for (let i = 0; i < 8; i++) {
    const open = i === 7;
    ev.push({ kind: 'note', layer: 'drums', beat: b0 + i * 0.5, durBeats: 0.25, midi: open ? DRUM.hatOpen : DRUM.hatClosed, vel: i % 2 === 0 ? 0.7 : 0.45 });
  }
  if (barIndex % 4 === 0) ev.push({ kind: 'note', layer: 'drums', beat: b0, durBeats: 1, midi: DRUM.crash, vel: 0.5 });

  // lead melody (every second bar so there is room to breathe)
  if (barIndex % 2 === 0 || barIndex % 4 === 3) {
    for (const [off, dur, midi] of c.lead) ev.push({ kind: 'note', layer: 'lead', beat: b0 + off, durBeats: dur, midi, vel: 0.75 });
  }

  // texture drone on the bass root two octaves up, every 4 bars
  if (barIndex % 4 === 0) ev.push({ kind: 'note', layer: 'texture', beat: b0, durBeats: 16, midi: c.root + 12, vel: 0.6 });
  return ev;
}

/** Build `bars` bars (default 8) of test music split into 4-bar batches. */
export function buildTestBatches(bars = 8, tempo = 92): EventBatch[] {
  const batches: EventBatch[] = [];
  for (let start = 0; start < bars; start += 4) {
    const n = Math.min(4, bars - start);
    const events: MusicEvent[] = [];
    for (let i = 0; i < n; i++) events.push(...barEvents(start + i));
    if (start === 0) {
      // gentle automation demo: open the pad filter + a bit more reverb over the first bars, noise bed on
      events.push({ kind: 'automation', target: 'filter.pad', beat: 0, value: 0.35 });
      events.push({ kind: 'automation', target: 'filter.pad', beat: 1, value: 0.8, rampBeats: Math.max(1, bars * 4 - 4) });
      events.push({ kind: 'automation', target: 'texture.noise', beat: 0, value: 0.4 });
      events.push({ kind: 'automation', target: 'send.reverb', beat: 0, value: 0.6 });
    }
    batches.push({
      version: SCHEMA_VERSION,
      startBeat: start * 4,
      endBeat: (start + n) * 4,
      tempo,
      timeSig: [4, 4],
      events,
    });
  }
  return batches;
}

export interface TestProgressionOptions {
  bars?: number;
  tempo?: number;
  mood?: MoodId;
}

/** Start the renderer, schedule the test progression from beat 0 and play it. Call from a user gesture. */
export async function playTestProgression(renderer: AudioRenderer, opts: TestProgressionOptions = {}): Promise<void> {
  await renderer.start();
  if (opts.mood) renderer.setMood(opts.mood);
  await renderer.reset(0.2);
  for (const b of buildTestBatches(opts.bars ?? 8, opts.tempo ?? 92)) renderer.schedule(b);
  renderer.play();
}
