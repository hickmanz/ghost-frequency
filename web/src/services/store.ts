import { create } from 'zustand';
import {
  DEFAULT_MIXER,
  DEFAULT_PARAMS,
  type GenerationParams,
  type LayerId,
  type MixerParams,
  type MoodId,
} from '@shared/index';
import type { TuningOverrides } from '../tuning/schema';
import { listBrowserEngines } from '../engines/registry';

export type BackendStatus = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error';
export type BackendActiveSource = 'remote' | 'local';

/** Live read-out written by the Conductor, read by the UI. */
export interface NowPlaying {
  bar: number;
  beatInBar: number;
  keyLabel: string; // e.g. "A minor"
  tempo: number;
  chordLabel: string; // e.g. "Fmaj7"
  sectionName: string; // e.g. "Build"
  sectionIndex: number;
}

export interface AppState {
  params: GenerationParams;
  mixer: MixerParams;
  audioReady: boolean;
  playing: boolean;
  busy: boolean; // regenerating
  now: NowPlaying;
  backend: {
    mode: 'browser' | 'python';
    url: string;
    token: string;
    status: BackendStatus;
    engines: { id: string; name: string }[];
    engineId: string;
    lastError?: string;
    activeSource?: BackendActiveSource;
    latencyMs?: number;
  };

  /** Sound Lab: per-mood overrides merged over built-in presets (see tuning/schema.ts). */
  tuning: Partial<Record<MoodId, TuningOverrides>>;
  /** Sound Lab: solo one layer (others silenced) / mute individual layers. Not persisted. */
  solo: LayerId | null;
  muted: Partial<Record<LayerId, boolean>>;
  labOpen: boolean;

  setTuningValue(mood: MoodId, key: string, value: number | undefined): void;
  /** Reset a single key, or all keys with the given prefix (e.g. 'arp.'), or everything for the mood when prefix omitted. */
  resetTuning(mood: MoodId, keyPrefix?: string): void;
  replaceTuning(t: Partial<Record<MoodId, TuningOverrides>>): void;
  setSolo(layer: LayerId | null): void;
  setMuted(layer: LayerId, muted: boolean): void;
  setLabOpen(open: boolean): void;

  setParams(p: Partial<GenerationParams>): void;
  setMixerLevel(k: LayerId | 'master', v: number): void;
  replaceAll(params: GenerationParams, mixer: MixerParams): void;
  setAudioReady(v: boolean): void;
  setPlaying(v: boolean): void;
  setBusy(v: boolean): void;
  setNow(n: Partial<NowPlaying>): void;
  setBackend(b: Partial<AppState['backend']>): void;
}

export const useStore = create<AppState>((set) => ({
  params: { ...DEFAULT_PARAMS },
  mixer: { ...DEFAULT_MIXER },
  audioReady: false,
  playing: false,
  busy: false,
  now: {
    bar: 0,
    beatInBar: 0,
    keyLabel: '-',
    tempo: 0,
    chordLabel: '-',
    sectionName: '-',
    sectionIndex: 0,
  },
  backend: {
    mode: 'browser',
    url: 'http://localhost:8000',
    token: '',
    status: 'disabled',
    engines: listBrowserEngines(),
    engineId: 'local-js',
  },

  tuning: {},
  solo: null,
  muted: {},
  labOpen: false,

  setTuningValue: (mood, key, value) =>
    set((s) => {
      const cur = { ...(s.tuning[mood] ?? {}) };
      if (value === undefined) delete cur[key];
      else cur[key] = value;
      return { tuning: { ...s.tuning, [mood]: cur } };
    }),
  resetTuning: (mood, keyPrefix) =>
    set((s) => {
      const cur = s.tuning[mood] ?? {};
      const next: TuningOverrides = {};
      if (keyPrefix !== undefined) {
        for (const [k, v] of Object.entries(cur)) if (!k.startsWith(keyPrefix)) next[k] = v;
      }
      return { tuning: { ...s.tuning, [mood]: next } };
    }),
  replaceTuning: (tuning) => set({ tuning }),
  setSolo: (solo) => set({ solo }),
  setMuted: (layer, muted) => set((s) => ({ muted: { ...s.muted, [layer]: muted } })),
  setLabOpen: (labOpen) => set({ labOpen }),

  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setMixerLevel: (k, v) => set((s) => ({ mixer: { ...s.mixer, [k]: v } })),
  replaceAll: (params, mixer) => set({ params: { ...params }, mixer: { ...mixer } }),
  setAudioReady: (audioReady) => set({ audioReady }),
  setPlaying: (playing) => set({ playing }),
  setBusy: (busy) => set({ busy }),
  setNow: (n) => set((s) => ({ now: { ...s.now, ...n } })),
  setBackend: (b) => set((s) => ({ backend: { ...s.backend, ...b } })),
}));
