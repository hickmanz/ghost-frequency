/**
 * Thin seam between UI and the playback system (Conductor).
 * The UI calls these; main.tsx registers the real implementation (engines/conductor.ts).
 */
export interface PlaybackController {
  /** First call must come from a user gesture (initialises audio). */
  play(): Promise<void>;
  pause(): void;
  /** Re-seed (optional new seed) and restart composition with a smooth fade. */
  regenerate(newSeed?: number): Promise<void>;
  /** Offline render N bars to a WAV file download (Phase 2). */
  exportWav?(bars: number): Promise<void>;
}

let current: PlaybackController | null = null;

export function setController(c: PlaybackController): void {
  current = c;
}

export function getController(): PlaybackController {
  if (!current) throw new Error('PlaybackController not registered yet');
  return current;
}
