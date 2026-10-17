import { create } from 'zustand';

/** Selectable main-screen visual modes. 'classic' is the original neon-grid visualizer. */
export type VisualMode = 'classic' | 'landscape' | 'spectrogram' | 'timeline';

export const VISUAL_MODES: readonly VisualMode[] = ['classic', 'landscape', 'spectrogram', 'timeline'];
export const DEFAULT_VISUAL_MODE: VisualMode = 'classic';
export const VISUAL_MODE_KEY = 'ghost-frequency:visualMode:v1';

export const VISUAL_MODE_LABEL: Record<VisualMode, string> = {
  classic: 'Classic',
  landscape: 'Landscape',
  spectrogram: 'Spectrogram',
  timeline: 'Timeline',
};

export function isVisualMode(v: unknown): v is VisualMode {
  return typeof v === 'string' && (VISUAL_MODES as readonly string[]).includes(v);
}

/** Validate a raw stored value (anything -> VisualMode). Unknown / missing -> default. */
export function parseVisualMode(raw: unknown): VisualMode {
  return isVisualMode(raw) ? raw : DEFAULT_VISUAL_MODE;
}

/** String written to localStorage. */
export function serializeVisualMode(mode: VisualMode): string {
  return mode;
}

/** Next mode in cycle order (wraps). */
export function nextVisualMode(mode: VisualMode, step = 1): VisualMode {
  const n = VISUAL_MODES.length;
  const i = VISUAL_MODES.indexOf(mode);
  return VISUAL_MODES[(((i < 0 ? 0 : i) + step) % n + n) % n]!;
}

function readStored(): VisualMode {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_VISUAL_MODE;
    return parseVisualMode(localStorage.getItem(VISUAL_MODE_KEY));
  } catch {
    return DEFAULT_VISUAL_MODE;
  }
}

function writeStored(mode: VisualMode): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(VISUAL_MODE_KEY, serializeVisualMode(mode));
  } catch {
    /* storage unavailable / full: the choice just won't persist */
  }
}

interface VisualModeState {
  mode: VisualMode;
  setMode(mode: VisualMode): void;
  cycle(step?: number): void;
}

/** UI-only store for the main-screen visual mode (persisted). */
export const useVisualMode = create<VisualModeState>((set, get) => ({
  mode: readStored(),
  setMode: (mode) => {
    if (!isVisualMode(mode) || mode === get().mode) return;
    writeStored(mode);
    set({ mode });
  },
  cycle: (step = 1) => {
    const mode = nextVisualMode(get().mode, step);
    writeStored(mode);
    set({ mode });
  },
}));
