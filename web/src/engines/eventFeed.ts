import type { EventBatch, KeySpec, MusicEvent } from '@shared/index';

/** One musical section as seen by visuals (derived from SectionEvents; chord changes share a sectionIndex). */
export interface SectionSpan {
  index: number;
  name: string;
  startBeat: number;
  /** start of the next known section, or Infinity while it is the latest one */
  endBeat: number;
  energy: number;
  key: KeySpec;
}

const BEATS_PER_BAR = 4;

/**
 * Rolling window of recently generated events (history + scheduled lookahead) for visualisations.
 * Pure TS, no audio. Bounded memory: keeps `maxBars` bars behind the newest bar.
 */
export class EventFeed {
  private readonly bars = new Map<number, MusicEvent[]>();
  private readonly tempoByBar = new Map<number, number>();
  private spans: SectionSpan[] = [];
  private newestBar = -1;

  constructor(private readonly maxBars = 192) {}

  clear(): void {
    this.bars.clear();
    this.tempoByBar.clear();
    this.spans = [];
    this.newestBar = -1;
  }

  /** Drop generated history before a hard seek (skip song). */
  dropBefore(beat: number): void {
    const minBar = Math.floor(beat / BEATS_PER_BAR);
    for (const b of this.bars.keys()) if (b < minBar) this.bars.delete(b);
    for (const b of this.tempoByBar.keys()) if (b < minBar) this.tempoByBar.delete(b);
    this.spans = this.spans.filter((s) => s.endBeat === Infinity || s.endBeat >= beat);
    for (let i = 0; i < this.spans.length; i++) {
      const s = this.spans[i]!;
      if (s.startBeat < beat && (s.endBeat === Infinity || s.endBeat > beat)) {
        this.spans[i] = { ...s, startBeat: beat };
      }
    }
  }

  add(batch: EventBatch): void {
    const firstBar = Math.floor(batch.startBeat / BEATS_PER_BAR);
    const lastBar = Math.max(firstBar, Math.ceil(batch.endBeat / BEATS_PER_BAR) - 1);
    for (let b = firstBar; b <= lastBar; b++) this.tempoByBar.set(b, batch.tempo);
    for (const ev of batch.events) {
      const bar = Math.floor(ev.beat / BEATS_PER_BAR);
      let list = this.bars.get(bar);
      if (!list) {
        list = [];
        this.bars.set(bar, list);
      }
      list.push(ev);
      if (ev.kind === 'section') this.noteSection(ev.sectionIndex, ev.name, ev.beat, ev.energy, ev.key);
    }
    if (lastBar > this.newestBar) this.newestBar = lastBar;
    this.prune();
  }

  /** Calls cb for every event with fromBeat <= beat < toBeat, in bar order (not strictly sorted inside a bar). No allocation. */
  forEachEvent(fromBeat: number, toBeat: number, cb: (e: MusicEvent) => void): void {
    if (toBeat <= fromBeat) return;
    const b0 = Math.floor(fromBeat / BEATS_PER_BAR);
    const b1 = Math.floor((toBeat - 1e-9) / BEATS_PER_BAR);
    for (let b = b0; b <= b1; b++) {
      const list = this.bars.get(b);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const e = list[i]!;
        if (e.beat >= fromBeat && e.beat < toBeat) cb(e);
      }
    }
  }

  /** Recent sections, oldest first. The returned array is replaced (not mutated) when sections change. */
  getSections(): readonly SectionSpan[] {
    return this.spans;
  }

  /** Tempo in effect at `beat` (latest known if beyond the window; 0 if nothing generated yet). */
  getBpmAt(beat: number): number {
    const bar = Math.floor(Math.max(0, beat) / BEATS_PER_BAR);
    return this.tempoByBar.get(bar) ?? this.tempoByBar.get(this.newestBar) ?? 0;
  }

  private noteSection(index: number, name: string, beat: number, energy: number, key: KeySpec): void {
    const last = this.spans[this.spans.length - 1];
    if (last && last.index === index) {
      if (last.energy !== energy || last.key !== key) {
        this.spans = [...this.spans.slice(0, -1), { ...last, energy, key }];
      }
      return;
    }
    const next: SectionSpan[] = this.spans.map((s, i) =>
      i === this.spans.length - 1 ? { ...s, endBeat: beat } : s,
    );
    next.push({ index, name, startBeat: beat, endBeat: Infinity, energy, key });
    this.spans = next.length > 64 ? next.slice(next.length - 64) : next;
  }

  private prune(): void {
    const minBar = this.newestBar - this.maxBars;
    if (minBar <= 0) return;
    for (const b of this.bars.keys()) if (b < minBar) this.bars.delete(b);
    for (const b of this.tempoByBar.keys()) if (b < minBar) this.tempoByBar.delete(b);
  }
}
