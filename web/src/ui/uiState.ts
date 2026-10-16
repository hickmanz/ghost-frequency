import { create } from 'zustand';
import { getController, type PlaybackController } from '../services/controller';
import { useStore } from '../services/store';
import { toSeed } from '../services/presets';

/** UI-only state (toast notices). Kept separate from the shared app store. */
interface UiState {
  notice: { id: number; text: string; kind: 'info' | 'error' } | null;
  notify(text: string, kind?: 'info' | 'error'): void;
  dismiss(): void;
}

let noticeId = 0;

export const useUiState = create<UiState>((set) => ({
  notice: null,
  notify: (text, kind = 'info') => set({ notice: { id: ++noticeId, text, kind } }),
  dismiss: () => set({ notice: null }),
}));

export function notify(text: string, kind: 'info' | 'error' = 'info'): void {
  useUiState.getState().notify(text, kind);
}

/** Returns the controller or null if it is not registered yet. Never throws. */
export function tryGetController(): PlaybackController | null {
  try {
    return getController();
  } catch {
    return null;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function randomSeed(): number {
  return toSeed(Math.random() * 4294967296);
}

/** Toggle play/pause via the controller. Shows a notice on failure. */
export async function togglePlayback(): Promise<void> {
  const c = tryGetController();
  if (!c) {
    notify('Audio engine is not ready yet.', 'error');
    return;
  }
  try {
    if (useStore.getState().playing) c.pause();
    else await c.play();
  } catch (e) {
    notify(`Playback failed: ${errorMessage(e)}`, 'error');
  }
}

/**
 * Set the seed in the store and regenerate with it. If the controller isn't registered the
 * store seed is still updated (so presets/seed UI stay consistent).
 */
export async function regenerateWithSeed(seed: number): Promise<void> {
  const s = toSeed(seed);
  useStore.getState().setParams({ seed: s });
  const c = tryGetController();
  if (!c) {
    notify('Audio engine is not ready yet - seed saved.', 'info');
    return;
  }
  try {
    await c.regenerate(s);
  } catch (e) {
    notify(`Regenerate failed: ${errorMessage(e)}`, 'error');
  }
}
