import { create } from 'zustand';

import {

  DEFAULT_CHAOS,

  DEFAULT_MIXER,

  DEFAULT_PARAMS,

  DEFAULT_STEER,

  DEFAULT_TONE,

  type ChaosParams,

  type EngineDescriptor,

  type GenerationParams,

  type LayerId,

  type MixerParams,

  type MoodId,

  type SteerParams,

  type ToneParams,

} from '@shared/index';

import type { TuningOverrides } from '../tuning/schema';

import { DEFAULT_BROWSER_ENGINE_ID, listBrowserEngines } from '../engines/registry';

import type { ModOffsets } from './director/effective';



export type BackendStatus = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error';

export type BackendActiveSource = 'remote' | 'local';



export interface NowPlaying {

  bar: number;

  beatInBar: number;

  keyLabel: string;

  tempo: number;

  chordLabel: string;

  sectionName: string;

  sectionIndex: number;

  songIndex: number;

  songTitle: string;

  songProgress: number;

  songStartBar: number;

}



export interface TrackHistoryEntry {

  index: number;

  title: string;

  keyLabel: string;

}



export interface AppState {

  params: GenerationParams;

  steer: SteerParams;

  tone: ToneParams;

  chaos: ChaosParams;

  pins: Partial<Record<string, boolean>>;

  mod: ModOffsets;

  mixer: MixerParams;

  audioReady: boolean;

  playing: boolean;

  busy: boolean;

  now: NowPlaying;

  trackHistory: TrackHistoryEntry[];

  advancedOpen: boolean;

  backend: {

    mode: 'browser' | 'python';

    url: string;

    token: string;

    status: BackendStatus;

    engines: EngineDescriptor[];

    engineId: string;

    lastError?: string;

    activeSource?: BackendActiveSource;

    latencyMs?: number;

    msPerBar?: number;

  };

  tuning: Partial<Record<MoodId, TuningOverrides>>;

  solo: LayerId | null;

  muted: Partial<Record<LayerId, boolean>>;

  labOpen: boolean;



  setSteer(p: Partial<SteerParams>): void;

  setTone(p: Partial<ToneParams>): void;

  setChaos(p: Partial<ChaosParams>): void;

  togglePin(key: string): void;

  setMod(mod: ModOffsets): void;

  pushHistory(entry: TrackHistoryEntry): void;

  setAdvancedOpen(open: boolean): void;



  setTuningValue(mood: MoodId, key: string, value: number | undefined): void;

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



export const INITIAL_NOW: NowPlaying = {

  bar: 0,

  beatInBar: 0,

  keyLabel: '-',

  tempo: 0,

  chordLabel: '-',

  sectionName: '-',

  sectionIndex: 0,

  songIndex: 0,

  songTitle: '-',

  songProgress: 0,

  songStartBar: 0,

};



export const useStore = create<AppState>((set) => ({

  params: { ...DEFAULT_PARAMS, steer: { ...DEFAULT_STEER } },

  steer: { ...DEFAULT_STEER },

  tone: { ...DEFAULT_TONE },

  chaos: { ...DEFAULT_CHAOS },

  pins: {},

  mod: {},

  mixer: { ...DEFAULT_MIXER },

  audioReady: false,

  playing: false,

  busy: false,

  now: { ...INITIAL_NOW },

  trackHistory: [],

  advancedOpen: false,

  backend: {

    mode: 'browser',

    url: 'http://localhost:8000',

    token: '',

    status: 'disabled',

    engines: listBrowserEngines(),

    engineId: DEFAULT_BROWSER_ENGINE_ID,

  },

  tuning: {},

  solo: null,

  muted: {},

  labOpen: false,

  setSteer: (p) =>

    set((s) => {

      const steer = { ...s.steer, ...p };

      return { steer, params: { ...s.params, steer } };

    }),

  setTone: (p) => set((s) => ({ tone: { ...s.tone, ...p } })),

  setChaos: (p) => set((s) => ({ chaos: { ...s.chaos, ...p } })),

  togglePin: (key) => set((s) => ({ pins: { ...s.pins, [key]: !s.pins[key] } })),

  setMod: (mod) => set({ mod }),

  pushHistory: (entry) =>

    set((s) => ({

      trackHistory: [...s.trackHistory.filter((t) => t.index !== entry.index), entry].slice(-24),

    })),

  setAdvancedOpen: (advancedOpen) => set({ advancedOpen }),



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


