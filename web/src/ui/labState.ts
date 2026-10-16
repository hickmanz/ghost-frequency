import { create } from 'zustand';
import type { TuningGroupId } from '../tuning/schema';

/**
 * Sound Lab UI-only state (not persisted, not part of the shared app store): which instrument tab is selected,
 * the dock height, and which parameter the user is hovering / dragging (drives the visuals' highlight).
 */
interface LabUiState {
  group: TuningGroupId;
  /** dock height as a fraction of the viewport height */
  frac: number;
  /** key of the param under the pointer / being dragged / focused (null = none) */
  focusKey: string | null;
  setGroup(g: TuningGroupId): void;
  setFrac(f: number): void;
}

export const FRAC_HALF = 0.54;
export const FRAC_TALL = 0.84;
export const FRAC_MIN = 0.3;
export const FRAC_MAX = 0.92;

export function clampFrac(f: number): number {
  return Math.min(FRAC_MAX, Math.max(FRAC_MIN, Number.isFinite(f) ? f : FRAC_HALF));
}

export const useLabUi = create<LabUiState>((set) => ({
  group: 'arp',
  frac: FRAC_HALF,
  focusKey: null,
  setGroup: (group) => set({ group, focusKey: null }),
  setFrac: (frac) => set({ frac: clampFrac(frac) }),
}));

let hoverKey: string | null = null;
let dragKey: string | null = null;
let focusedKey: string | null = null;

function publish(): void {
  const k = dragKey ?? hoverKey ?? focusedKey;
  if (useLabUi.getState().focusKey !== k) useLabUi.setState({ focusKey: k });
}

export function hoverParam(key: string | null): void {
  hoverKey = key;
  publish();
}

export function focusParam(key: string | null): void {
  focusedKey = key;
  publish();
}

/** Keeps the key highlighted until the pointer is released, even if it leaves the row. */
export function beginParamDrag(key: string): void {
  dragKey = key;
  publish();
  const end = () => {
    dragKey = null;
    publish();
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

export function clearParamFocus(): void {
  hoverKey = null;
  dragKey = null;
  focusedKey = null;
  publish();
}
