/**
 * Symbolic scores for comparing composers. Higher arpSimilarity means a later bar
 * still matches the bar one loop earlier. Motif spread is how many lead pitch-classes
 * also show up in the arp or bass. Collisions count lead and arp attacks on the same beat.
 * Peak is a velocity sum over a one-beat window, a stand-in for level before the limiter.
 */
import type { EventBatch, MusicEvent, NoteEvent } from '@shared/index';

export interface CriticScore {
  arpSimilarity: number;
  motifSpread: number;
  leadArpCollisions: number;
  voiceLeading: number;
  peak: number;
}

function notesOf(events: readonly MusicEvent[]): NoteEvent[] {
  return events.filter((e): e is NoteEvent => e.kind === 'note');
}

function barOf(beat: number): number {
  return Math.floor(beat / 4);
}

function pcs(notes: readonly NoteEvent[], bar: number): number[] {
  return notes
    .filter((n) => n.layer === 'arp' && barOf(n.beat) === bar)
    .sort((a, b) => a.beat - b.beat)
    .map((n) => n.midi % 12);
}

/** 1 = the arp pitch sequence matches the bar one loop earlier. */
function arpSimilarity(notes: readonly NoteEvent[], loop = 8): number {
  const bars = new Set(notes.filter((n) => n.layer === 'arp').map((n) => barOf(n.beat)));
  let sum = 0;
  let total = 0;
  for (const bar of bars) {
    if (!bars.has(bar - loop)) continue;
    const a = pcs(notes, bar);
    const b = pcs(notes, bar - loop);
    if (a.length === 0 || b.length === 0) continue;
    const n = Math.max(a.length, b.length);
    let same = 0;
    const m = Math.min(a.length, b.length);
    for (let i = 0; i < m; i++) if (a[i] === b[i]) same++;
    sum += same / n;
    total++;
  }
  return total === 0 ? 0 : sum / total;
}

function motifSpread(notes: readonly NoteEvent[]): number {
  const lead = new Set(notes.filter((n) => n.layer === 'lead').map((n) => n.midi % 12));
  if (lead.size === 0) return 0;
  const other = new Set(
    notes.filter((n) => n.layer === 'arp' || n.layer === 'bass' || n.layer === 'bell').map((n) => n.midi % 12),
  );
  let hit = 0;
  for (const pc of lead) if (other.has(pc)) hit++;
  return hit / lead.size;
}

function collisions(notes: readonly NoteEvent[]): number {
  const arp = notes.filter((n) => n.layer === 'arp');
  const lead = notes.filter((n) => n.layer === 'lead');
  let n = 0;
  for (const a of arp) {
    if (lead.some((l) => Math.abs(l.beat - a.beat) < 0.08)) n++;
  }
  return n;
}

function voiceLeading(notes: readonly NoteEvent[]): number {
  const pads = notes.filter((n) => n.layer === 'pad').sort((a, b) => a.beat - b.beat);
  const groups: { beat: number; midis: number[] }[] = [];
  for (const n of pads) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(n.beat - g.beat) < 0.15) g.midis.push(n.midi);
    else groups.push({ beat: n.beat, midis: [n.midi] });
  }
  if (groups.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < groups.length; i++) {
    const a = groups[i - 1]!.midis;
    const b = groups[i]!.midis;
    let m = 0;
    for (const x of b) {
      let best = Infinity;
      for (const y of a) best = Math.min(best, Math.abs(x - y));
      m += best;
    }
    sum += m / b.length;
  }
  return sum / (groups.length - 1);
}

function peak(notes: readonly NoteEvent[]): number {
  if (notes.length === 0) return 0;
  const beats = notes.map((n) => n.beat);
  const lo = Math.min(...beats);
  const hi = Math.max(...notes.map((n) => n.beat + n.durBeats));
  let max = 0;
  for (let t = lo; t < hi; t += 1) {
    let s = 0;
    for (const n of notes) {
      if (n.layer === 'drums') continue;
      if (n.beat < t + 1 && n.beat + n.durBeats > t) s += n.vel;
    }
    if (s > max) max = s;
  }
  return max;
}

export function scoreEvents(events: readonly MusicEvent[]): CriticScore {
  const notes = notesOf(events);
  return {
    arpSimilarity: arpSimilarity(notes),
    motifSpread: motifSpread(notes),
    leadArpCollisions: collisions(notes),
    voiceLeading: voiceLeading(notes),
    peak: peak(notes),
  };
}

export function scoreBatches(batches: readonly EventBatch[]): CriticScore {
  return scoreEvents(batches.flatMap((b) => b.events));
}
