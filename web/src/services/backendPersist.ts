import type { StoreApi } from 'zustand';
import type { AppState } from './store';
import { defaultStorage } from './presets';

export const BACKEND_KEY = 'ghost-frequency:backend:v1';

export type SavedBackend = Pick<AppState['backend'], 'mode' | 'url' | 'token' | 'engineId'>;

export function loadBackend(): Partial<SavedBackend> | null {
  const ls = defaultStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(BACKEND_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedBackend>;
    if (data.mode !== 'browser' && data.mode !== 'python') return null;
    return data;
  } catch {
    return null;
  }
}

export function startBackendPersistence(store: StoreApi<AppState>): { flush: () => void } {
  const ls = defaultStorage();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!ls) return;
    const b = store.getState().backend;
    const payload: SavedBackend = {
      mode: b.mode,
      url: b.url,
      token: b.token,
      engineId: b.engineId,
    };
    ls.setItem(BACKEND_KEY, JSON.stringify(payload));
  };

  store.subscribe((state, prev) => {
    if (
      state.backend.mode === prev.backend.mode &&
      state.backend.url === prev.backend.url &&
      state.backend.token === prev.backend.token &&
      state.backend.engineId === prev.backend.engineId
    ) {
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, 500);
  });

  return { flush };
}
