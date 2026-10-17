import type { KeySpec, MusicEvent } from '@shared/index';

export interface FeedSection {
  index: number;
  name: string;
  startBeat: number;
  /** Infinity while it is the latest known section */
  endBeat: number;
  energy: number;
  key: KeySpec;
}

/**
 * Injected data source of musical events for main-screen visuals (keeps ui/ free of engine/audio imports).
 * Beats are absolute song beats (4 beats per bar). Registered in main.tsx.
 */
export interface FeedSource {
  /** Current audio-clock position in beats (smooth, latency-compensated). 0 before playback. */
  getBeat(): number;
  /** BPM in effect at `beat` (0 if unknown). */
  getBpmAt(beat: number): number;
  /**
   * Calls cb for every generated event with fromBeat <= beat < toBeat (history up to ~190 bars back,
   * lookahead ~4 bars forward). No allocation per call. NoteEvent/AutomationEvent/SectionEvent only matter to visuals.
   */
  forEachEvent(fromBeat: number, toBeat: number, cb: (e: MusicEvent) => void): void;
  /** Recent sections, oldest first (the array identity changes only when sections change). */
  getSections(): readonly FeedSection[];
}

let source: FeedSource | null = null;
export function setFeedSource(s: FeedSource | null): void {
  source = s;
}
export function getFeedSource(): FeedSource | null {
  return source;
}
