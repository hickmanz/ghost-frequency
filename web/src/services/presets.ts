/**
 * Preset + last-used persistence. Pure logic (validate / clamp / serialize) lives here so it can be
 * unit-tested in node; storage is always injected (default = globalThis.localStorage when available).
 */
import {
  DEFAULT_MIXER,
  DEFAULT_PARAMS,
  LAYER_IDS,
  MOOD_IDS,
  type GenerationParams,
  type MixerParams,
  type MoodId,
  type Preset,
} from '@shared/index';
import type { TuningOverrides } from '../tuning/schema';

export const PRESETS_KEY = 'ghost-frequency:presets:v1';
export const LAST_KEY = 'ghost-frequency:last:v1';

export const TEMPO_MIN = 50;
export const TEMPO_MAX = 130;
export const SEED_MAX = 0xffffffff;
export const MAX_PRESETS = 100;
export const MAX_NAME_LENGTH = 60;

/** Minimal subset of the Web Storage API. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returns window.localStorage if usable, else null (SSR / node / privacy mode). */
export function defaultStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// clamping / sanitizing
// ---------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function isMoodId(v: unknown): v is MoodId {
  return typeof v === 'string' && (MOOD_IDS as readonly string[]).includes(v);
}

/** Coerce any number to an integer uint32 seed. */
export function toSeed(n: number): number {
  return Math.trunc(n) >>> 0;
}

function unit(raw: unknown, fallback: number): number {
  return isFiniteNumber(raw) ? clamp01(raw) : fallback;
}

/**
 * Validate + clamp a params object. Unknown/invalid fields fall back to defaults.
 * Returns null if `raw` is not an object at all.
 */
export function sanitizeParams(raw: unknown, fallback: GenerationParams = DEFAULT_PARAMS): GenerationParams | null {
  if (!isRecord(raw)) return null;
  let tempo: number | null;
  if (raw.tempo === null) tempo = null;
  else if (isFiniteNumber(raw.tempo)) tempo = Math.round(clamp(raw.tempo, TEMPO_MIN, TEMPO_MAX));
  else tempo = fallback.tempo;
  return {
    mood: isMoodId(raw.mood) ? raw.mood : fallback.mood,
    energy: unit(raw.energy, fallback.energy),
    complexity: unit(raw.complexity, fallback.complexity),
    variation: unit(raw.variation, fallback.variation),
    tempo,
    seed: isFiniteNumber(raw.seed) ? toSeed(raw.seed) : fallback.seed,
  };
}

/** Validate + clamp a mixer object. Missing/invalid faders fall back to defaults. Null if not an object. */
export function sanitizeMixer(raw: unknown, fallback: MixerParams = DEFAULT_MIXER): MixerParams | null {
  if (!isRecord(raw)) return null;
  const out = { ...fallback } as MixerParams;
  for (const id of LAYER_IDS) out[id] = unit(raw[id], fallback[id]);
  out.master = unit(raw.master, fallback.master);
  return out;
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

/** Validate a single preset entry. Returns null for malformed entries. */
export function validatePreset(raw: unknown): Preset | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== 1) return null;
  const name = sanitizeName(raw.name);
  const params = sanitizeParams(raw.params);
  const mixer = sanitizeMixer(raw.mixer);
  if (!name || !params || !mixer) return null;
  return {
    version: 1,
    name,
    params,
    mixer,
    savedAt: isFiniteNumber(raw.savedAt) ? raw.savedAt : 0,
  };
}

/** Build a preset from live state (deep-copies and sanitizes). Returns null if name is empty. */
export function makePreset(
  name: string,
  params: GenerationParams,
  mixer: MixerParams,
  now: number = Date.now(),
): Preset | null {
  const n = sanitizeName(name);
  if (!n) return null;
  return {
    version: 1,
    name: n,
    params: sanitizeParams(params) ?? { ...DEFAULT_PARAMS },
    mixer: sanitizeMixer(mixer) ?? { ...DEFAULT_MIXER },
    savedAt: now,
  };
}

// ---------------------------------------------------------------------------------------------
// list operations (pure)
// ---------------------------------------------------------------------------------------------

/** Add or replace (case-insensitive name match) a preset; caps the list at MAX_PRESETS (drops oldest). */
export function upsertPreset(list: readonly Preset[], preset: Preset): Preset[] {
  const key = preset.name.toLowerCase();
  const idx = list.findIndex((p) => p.name.toLowerCase() === key);
  const next = list.slice();
  if (idx >= 0) next[idx] = preset;
  else next.push(preset);
  return next.length > MAX_PRESETS ? next.slice(next.length - MAX_PRESETS) : next;
}

export function removePreset(list: readonly Preset[], name: string): Preset[] {
  const key = name.toLowerCase();
  return list.filter((p) => p.name.toLowerCase() !== key);
}

// ---------------------------------------------------------------------------------------------
// (de)serialization
// ---------------------------------------------------------------------------------------------

export function serializePresets(list: readonly Preset[]): string {
  return JSON.stringify(list);
}

/**
 * Parse JSON text into a validated preset list. Accepts a JSON array or a single preset object
 * (handy for import). Malformed entries are dropped; broken JSON yields []. Duplicate names collapse.
 */
export function parsePresets(text: string | null | undefined): Preset[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const entries = Array.isArray(data) ? data : [data];
  let out: Preset[] = [];
  for (const e of entries) {
    const p = validatePreset(e);
    if (p) out = upsertPreset(out, p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------------------------

export function loadPresets(storage: StorageLike | null = defaultStorage()): Preset[] {
  if (!storage) return [];
  try {
    return parsePresets(storage.getItem(PRESETS_KEY));
  } catch {
    return [];
  }
}

/** Returns false on quota / security errors or when no storage is available. */
export function savePresets(list: readonly Preset[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PRESETS_KEY, serializePresets(list));
    return true;
  } catch {
    return false;
  }
}

export interface LastUsed {
  params: GenerationParams;
  mixer: MixerParams;
}

/** Parse the persisted last-used blob (pure). */
export function parseLast(text: string | null | undefined): LastUsed | null {
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const params = sanitizeParams(data.params);
  const mixer = sanitizeMixer(data.mixer);
  if (!params || !mixer) return null;
  return { params, mixer };
}

export function serializeLast(params: GenerationParams, mixer: MixerParams): string {
  return JSON.stringify({ version: 1, params, mixer });
}

export function loadLast(storage: StorageLike | null = defaultStorage()): LastUsed | null {
  if (!storage) return null;
  try {
    return parseLast(storage.getItem(LAST_KEY));
  } catch {
    return null;
  }
}

export function saveLast(
  params: GenerationParams,
  mixer: MixerParams,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LAST_KEY, serializeLast(params, mixer));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// debounce + store persistence
// ---------------------------------------------------------------------------------------------

export interface Debounced {
  /** schedule (re-arms the timer) */
  call(): void;
  /** run immediately if pending */
  flush(): void;
  cancel(): void;
}

export function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

interface Snapshot {
  params: GenerationParams;
  mixer: MixerParams;
}

/** Structural subset of the zustand store hook used by startPersistence. */
export interface PersistableStore {
  getState(): Snapshot;
  subscribe(listener: (state: Snapshot, prev: Snapshot) => void): () => void;
}

/**
 * Save params+mixer to LAST_KEY (debounced) whenever either changes. Returns stop() and flush().
 */
export function startPersistence(
  store: PersistableStore,
  storage: StorageLike | null = defaultStorage(),
  ms = 500,
): { stop(): void; flush(): void } {
  const d = debounce(() => {
    const s = store.getState();
    saveLast(s.params, s.mixer, storage);
  }, ms);
  const unsub = store.subscribe((s, prev) => {
    if (s.params !== prev.params || s.mixer !== prev.mixer) d.call();
  });
  return {
    stop() {
      unsub();
      d.cancel();
    },
    flush: () => d.flush(),
  };
}

// ---------------------------------------------------------------------------------------------
// Sound Lab tuning persistence (separate from presets: Preset type is unchanged)
// ---------------------------------------------------------------------------------------------

export const TUNING_KEY = 'ghost-frequency:tuning:v1';
/** Sanity caps so a corrupt / hostile blob can't bloat memory or storage. */
export const MAX_TUNING_KEYS_PER_MOOD = 300;
export const MAX_TUNING_KEY_LENGTH = 80;

export type TuningState = Partial<Record<MoodId, TuningOverrides>>;

const TUNING_KEY_RE = /^[A-Za-z0-9_.\-]+$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Validate a per-mood override map: known moods only, finite numbers only. Keys are NOT checked
 * against the current schema (so renamed/removed params survive schema changes); they only have
 * to look like dotted identifiers, and the count per mood is capped. Moods with no valid entries
 * are omitted. Returns null if `raw` isn't an object.
 */
export function sanitizeTuning(raw: unknown): TuningState | null {
  if (!isRecord(raw)) return null;
  const out: TuningState = {};
  for (const mood of MOOD_IDS) {
    const src = raw[mood];
    if (!isRecord(src)) continue;
    const dst: TuningOverrides = {};
    let n = 0;
    for (const [k, v] of Object.entries(src)) {
      if (n >= MAX_TUNING_KEYS_PER_MOOD) break;
      if (k.length === 0 || k.length > MAX_TUNING_KEY_LENGTH) continue;
      if (FORBIDDEN_KEYS.has(k) || !TUNING_KEY_RE.test(k)) continue;
      if (!isFiniteNumber(v)) continue;
      dst[k] = v;
      n++;
    }
    if (n > 0) out[mood] = dst;
  }
  return out;
}

/** Parse the persisted tuning blob (pure). Null when missing / malformed / wrong version. */
export function parseTuning(text: string | null | undefined): TuningState | null {
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== 1) return null;
  return sanitizeTuning(data.tuning);
}

export function serializeTuning(tuning: TuningState): string {
  return JSON.stringify({ version: 1, tuning: sanitizeTuning(tuning) ?? {} });
}

export function loadTuning(storage: StorageLike | null = defaultStorage()): TuningState | null {
  if (!storage) return null;
  try {
    return parseTuning(storage.getItem(TUNING_KEY));
  } catch {
    return null;
  }
}

export function saveTuning(tuning: TuningState, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TUNING_KEY, serializeTuning(tuning));
    return true;
  } catch {
    return false;
  }
}

/** Structural subset of the zustand store hook used by startTuningPersistence. */
export interface TuningPersistableStore {
  getState(): { tuning: TuningState };
  subscribe(listener: (state: { tuning: TuningState }, prev: { tuning: TuningState }) => void): () => void;
}

/** Save store.tuning to TUNING_KEY (debounced) whenever it changes. Returns stop() and flush(). */
export function startTuningPersistence(
  store: TuningPersistableStore,
  storage: StorageLike | null = defaultStorage(),
  ms = 500,
): { stop(): void; flush(): void } {
  const d = debounce(() => saveTuning(store.getState().tuning, storage), ms);
  const unsub = store.subscribe((s, prev) => {
    if (s.tuning !== prev.tuning) d.call();
  });
  return {
    stop() {
      unsub();
      d.cancel();
    },
    flush: () => d.flush(),
  };
}
