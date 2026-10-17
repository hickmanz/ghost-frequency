import type { MoodId } from '@shared/index';
import { clamp, clamp01, hash01, mulberry32, smoothstep } from './common';

/** Pure data + math for the Landscape mode (unit-tested). No DOM access. */

export type SunKind = 'stripes' | 'soft' | 'moon' | 'planet';
type Stops = readonly (readonly [number, string])[];

export interface SunStyle {
  kind: SunKind;
  stops: Stops;
  /** rgba colour of the soft halo */
  glow: string;
  /** radius multiplier relative to the base sun radius */
  radius: number;
  /** centre x as a fraction of the width */
  x: number;
  /** centre y: fraction of the sky height measured from the horizon upwards (0 = on the horizon) */
  y: number;
  /** planet ring colour */
  ring?: string;
}

export interface NebulaBlob {
  x: number;
  y: number;
  r: number;
  color: string;
}

export interface RidgeStyle {
  /** far, mid, near */
  colors: readonly [string, string, string];
  /** amplitude as a fraction of the sky height */
  heights: readonly [number, number, number];
  ridged: boolean;
  rim: string | null;
}

export interface Theme {
  id: MoodId;
  sky: Stops;
  ground: Stops;
  horizonGlow: string;
  sun: SunStyle;
  nebula: readonly NebulaBlob[];
  ridges: RidgeStyle;
  gridH: string;
  gridV: string;
  gridAmount: number;
  starCount: number;
  starAlpha: number;
  /** city skyline height scale (0 = none) */
  city: number;
  cityColor: string;
  windowColors: readonly [string, string];
  rain: boolean;
  fog: number;
  fogColor: string;
  flashColor: string;
  flashAlpha: number;
  rippleKick: string;
  rippleBass: string;
}

export const THEMES: Record<MoodId, Theme> = {
  dreamy: {
    id: 'dreamy',
    sky: [
      [0, '#4a3a8f'],
      [0.45, '#b585d9'],
      [0.8, '#ff9fc4'],
      [1, '#ffd2a8'],
    ],
    ground: [
      [0, '#6a3b8f'],
      [0.3, '#3a2470'],
      [1, '#1c1040'],
    ],
    horizonGlow: 'rgba(255, 205, 175, 0.55)',
    sun: {
      kind: 'soft',
      stops: [
        [0, '#fff0c8'],
        [0.5, '#ffb3d1'],
        [1, '#c9a2ff'],
      ],
      glow: 'rgba(255, 190, 230, 0.5)',
      radius: 1.15,
      x: 0.5,
      y: 0.12,
    },
    nebula: [],
    ridges: {
      colors: ['#a47bd0', '#8660bd', '#5c4290'],
      heights: [0.2, 0.14, 0.09],
      ridged: false,
      rim: null,
    },
    gridH: '#ff9fe0',
    gridV: '#c9a2ff',
    gridAmount: 0.6,
    starCount: 30,
    starAlpha: 0.5,
    city: 0,
    cityColor: '#3a2470',
    windowColors: ['#ffe9b0', '#ffc2f0'],
    rain: false,
    fog: 0.28,
    fogColor: 'rgba(255, 205, 240, 1)',
    flashColor: '#fff0fa',
    flashAlpha: 0.12,
    rippleKick: '#ffd0ec',
    rippleBass: '#bfa6ff',
  },
  dark: {
    id: 'dark',
    sky: [
      [0, '#010108'],
      [0.6, '#0a0a2e'],
      [1, '#1d1347'],
    ],
    ground: [
      [0, '#0c0a28'],
      [0.3, '#070620'],
      [1, '#020110'],
    ],
    horizonGlow: 'rgba(120, 60, 255, 0.4)',
    sun: {
      kind: 'moon',
      stops: [
        [0, '#8a2243'],
        [1, '#2a0b3a'],
      ],
      glow: 'rgba(255, 40, 90, 0.24)',
      radius: 0.6,
      x: 0.72,
      y: 0.5,
    },
    nebula: [],
    ridges: {
      colors: ['#15123c', '#0c0b2a', '#04030e'],
      heights: [0.3, 0.2, 0.11],
      ridged: true,
      rim: null,
    },
    gridH: '#19e6ff',
    gridV: '#6a5cff',
    gridAmount: 0.55,
    starCount: 60,
    starAlpha: 0.35,
    city: 0.85,
    cityColor: '#070618',
    windowColors: ['#ff4466', '#19e6ff'],
    rain: true,
    fog: 0.75,
    fogColor: 'rgba(110, 130, 220, 1)',
    flashColor: '#a8c8ff',
    flashAlpha: 0.32,
    rippleKick: '#ff3355',
    rippleBass: '#19e6ff',
  },
  nostalgic: {
    id: 'nostalgic',
    sky: [
      [0, '#0b0320'],
      [0.5, '#3a0a5e'],
      [0.82, '#b4237a'],
      [1, '#ff7a3d'],
    ],
    ground: [
      [0, '#2a0838'],
      [0.25, '#10052a'],
      [1, '#05010f'],
    ],
    horizonGlow: 'rgba(255, 90, 200, 0.5)',
    sun: {
      kind: 'stripes',
      stops: [
        [0, '#ffe14d'],
        [0.5, '#ff4fa3'],
        [1, '#b01cff'],
      ],
      glow: 'rgba(255, 60, 200, 0.4)',
      radius: 1,
      x: 0.5,
      y: 0.4,
    },
    nebula: [],
    ridges: {
      colors: ['#4a1262', '#2a0b4a', '#12052a'],
      heights: [0.25, 0.16, 0.08],
      ridged: true,
      rim: '#ff2bd6',
    },
    gridH: '#ff2bd6',
    gridV: '#8b5cff',
    gridAmount: 1,
    starCount: 60,
    starAlpha: 0.55,
    city: 0.7,
    cityColor: '#150433',
    windowColors: ['#ffd23d', '#19e6ff'],
    rain: false,
    fog: 0,
    fogColor: 'rgba(255, 90, 200, 1)',
    flashColor: '#ffe6fb',
    flashAlpha: 0.16,
    rippleKick: '#ffdd55',
    rippleBass: '#19e6ff',
  },
  space: {
    id: 'space',
    sky: [
      [0, '#000008'],
      [0.5, '#0b0636'],
      [1, '#1b0b4f'],
    ],
    ground: [
      [0, '#07041c'],
      [0.4, '#040212'],
      [1, '#020108'],
    ],
    horizonGlow: 'rgba(110, 120, 255, 0.35)',
    sun: {
      kind: 'planet',
      stops: [
        [0, '#ff9a6c'],
        [0.55, '#a43cff'],
        [1, '#2a0b5a'],
      ],
      glow: 'rgba(160, 120, 255, 0.3)',
      radius: 0.62,
      x: 0.74,
      y: 0.62,
      ring: 'rgba(255, 215, 250, 0.6)',
    },
    nebula: [
      { x: 0.25, y: 0.4, r: 0.5, color: 'rgba(160, 60, 255, 0.38)' },
      { x: 0.72, y: 0.6, r: 0.45, color: 'rgba(25, 230, 255, 0.22)' },
      { x: 0.5, y: 0.2, r: 0.36, color: 'rgba(255, 43, 214, 0.2)' },
    ],
    ridges: {
      colors: ['#14103a', '#0c0a2a', '#06041a'],
      heights: [0.07, 0.045, 0.025],
      ridged: false,
      rim: null,
    },
    gridH: '#6c8bff',
    gridV: '#8b5cff',
    gridAmount: 0.24,
    starCount: 160,
    starAlpha: 1,
    city: 0,
    cityColor: '#06041a',
    windowColors: ['#ffffff', '#ffffff'],
    rain: false,
    fog: 0,
    fogColor: 'rgba(110, 120, 255, 1)',
    flashColor: '#cfe6ff',
    flashAlpha: 0.1,
    rippleKick: '#8b5cff',
    rippleBass: '#19e6ff',
  },
};

export const THEME_ORDER: readonly MoodId[] = ['dreamy', 'dark', 'nostalgic', 'space'];

export function themeFor(mood: string): Theme {
  return (THEMES as Record<string, Theme | undefined>)[mood] ?? THEMES.nostalgic;
}

// ---------------------------------------------------------------------------------------------
// Theme cross-fade
// ---------------------------------------------------------------------------------------------

export interface Crossfade {
  from: MoodId;
  to: MoodId;
  /** 0..1 progress of the fade from -> to */
  t: number;
}

export const CROSSFADE_MS = 3000;

/**
 * Advance the cross-fade towards `target`. A change of target restarts the fade; if one was still running,
 * the theme that currently dominates becomes the new `from` (so quick mood switches don't pop much).
 */
export function stepCrossfade(cf: Crossfade, target: MoodId, dtMs: number, durMs = CROSSFADE_MS): void {
  if (target === cf.to) {
    cf.t = clamp01(cf.t + dtMs / Math.max(1, durMs));
    return;
  }
  if (target === cf.from) {
    // reversing a fade in progress: swap so the visual mix stays continuous
    cf.from = cf.to;
    cf.to = target;
    cf.t = 1 - cf.t;
    return;
  }
  cf.from = cf.t >= 0.5 ? cf.to : cf.from;
  cf.to = target;
  cf.t = 0;
}

/** Eased weight of the incoming theme. */
export function crossfadeWeight(cf: Crossfade): number {
  return smoothstep(cf.t);
}

// ---------------------------------------------------------------------------------------------
// Event interpretation
// ---------------------------------------------------------------------------------------------

export type DrumKind = 'kick' | 'snare' | 'hat' | 'crash' | 'tom' | 'none';

export function drumKind(midi: number): DrumKind {
  switch (midi) {
    case 36:
      return 'kick';
    case 38:
    case 39:
      return 'snare';
    case 42:
    case 46:
      return 'hat';
    case 49:
      return 'crash';
    case 43:
      return 'tom';
    default:
      return 'none';
  }
}

/** 0 (low / warm) .. 1 (high / cold) for a MIDI pitch. */
export function pitchCold(midi: number): number {
  return clamp01((midi - 36) / 60);
}

/** Warm -> cold particle palette (index by pitchCold). */
export const PARTICLE_PALETTE: readonly string[] = [
  '#ff9a5c',
  '#ff7a7a',
  '#ff4fa3',
  '#ff2bd6',
  '#c25cff',
  '#8b5cff',
  '#6a8bff',
  '#4aa9ff',
  '#19e6ff',
  '#7ff3ff',
  '#c8fbff',
  '#f2ffff',
];

export function paletteIndex(midi: number): number {
  return Math.min(PARTICLE_PALETTE.length - 1, Math.floor(pitchCold(midi) * PARTICLE_PALETTE.length));
}

/** Which of `count` stars twinkles for a pitch (higher pitch -> higher index; stars are ordered low->high index = low->high in the sky). */
export function starIndexForPitch(midi: number, count: number, salt: number): number {
  if (count <= 0) return 0;
  const base = pitchCold(midi) * (count - 1);
  const jitter = (hash01(midi, salt) - 0.5) * 0.16 * count;
  return Math.round(clamp(base + jitter, 0, count - 1));
}

/** Vertical position of a pitch in the sky as a 0..1 fraction (0 = top, 1 = horizon). */
export function pitchSkyFrac(midi: number): number {
  return 1 - (0.08 + 0.8 * pitchCold(midi));
}

/** Scroll speed multiplier from tempo (BPM) and energy (0..1). ~1 at 100 BPM / 0.5 energy. */
export function scrollSpeed(bpm: number, energy: number): number {
  const t = clamp(bpm > 0 ? bpm : 100, 50, 200) / 100;
  return (0.5 + 0.5 * t) * (0.55 + 0.9 * clamp01(energy));
}

/** Exponential decay of a 0..1 impulse. */
export function decayImpulse(v: number, dtMs: number, tauMs: number): number {
  return v <= 0.0005 ? 0 : v * Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));
}

// ---------------------------------------------------------------------------------------------
// Fixed-size particle pool (structure of arrays, no allocation after construction)
// ---------------------------------------------------------------------------------------------

export const PARTICLE_CAP = 150;

export class ParticlePool {
  readonly cap: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly color: Uint8Array;
  readonly kind: Uint8Array;
  private next = 0;

  constructor(cap = PARTICLE_CAP) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap); // 0 = dead
    this.size = new Float32Array(cap);
    this.color = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
  }

  /** Spawn a particle (overwrites the oldest slot in round-robin order when full). Velocities in px/ms. */
  spawn(kind: number, x: number, y: number, vx: number, vy: number, lifeMs: number, size: number, color: number): void {
    // prefer a dead slot within a few probes, else recycle round-robin
    let i = this.next;
    for (let k = 0; k < 8; k++) {
      const j = (this.next + k) % this.cap;
      if (this.life[j]! <= 0) {
        i = j;
        break;
      }
    }
    this.next = (i + 1) % this.cap;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = Math.max(1, lifeMs);
    this.size[i] = size;
    this.color[i] = color;
    this.kind[i] = kind;
  }

  step(dtMs: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i]! <= 0) continue;
      const a = this.age[i]! + dtMs;
      if (a >= this.life[i]!) {
        this.life[i] = 0;
        continue;
      }
      this.age[i] = a;
      this.x[i] = this.x[i]! + this.vx[i]! * dtMs;
      this.y[i] = this.y[i]! + this.vy[i]! * dtMs;
    }
  }

  alive(): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.life[i]! > 0) n++;
    return n;
  }

  clear(): void {
    this.life.fill(0);
    this.next = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Procedural geometry
// ---------------------------------------------------------------------------------------------

export const RIDGE_TABLE_SIZE = 720;
export const RIDGE_CELLS = 24;
export const RIDGE_SAMPLES_PER_CELL = RIDGE_TABLE_SIZE / RIDGE_CELLS;

/** Pixel width of one noise cell for ridge layer `layer` (0 far .. 2 near). */
export function ridgeCellPx(width: number, layer: number): number {
  return width * (layer === 0 ? 0.26 : layer === 1 ? 0.17 : 0.11);
}

/** Convert a pixel offset to a table position for ridge layer `layer`. */
export function ridgeTablePos(px: number, width: number, layer: number): number {
  return (px / ridgeCellPx(width, layer)) * RIDGE_SAMPLES_PER_CELL;
}

export interface Skyline {
  x: Float32Array;
  w: Float32Array;
  /** height as a 0..1 fraction of the maximum skyline height */
  h: Float32Array;
  tileW: number;
}

export const BUILDING_COUNT = 34;

/** Deterministic skyline tile covering `tileW` px, buildings sorted by x. */
export function buildSkyline(seed: number, width: number): Skyline {
  const rnd = mulberry32(seed ^ 0x51ed270b);
  const tileW = width * 1.3 + 90;
  const x = new Float32Array(BUILDING_COUNT);
  const w = new Float32Array(BUILDING_COUNT);
  const h = new Float32Array(BUILDING_COUNT);
  const slot = tileW / BUILDING_COUNT;
  for (let i = 0; i < BUILDING_COUNT; i++) {
    x[i] = i * slot + rnd() * slot * 0.25;
    w[i] = slot * (0.7 + rnd() * 0.9);
    // a few tall towers among lower blocks
    const r = rnd();
    h[i] = r > 0.86 ? 0.75 + rnd() * 0.25 : 0.2 + rnd() * 0.45;
  }
  return { x, w, h, tileW };
}

/** Seeded star field; star index i is placed at height rank i (low index = low in the sky). */
export function buildStars(seed: number, count: number, xs: Float32Array, ys: Float32Array, sizes: Float32Array): void {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < count; i++) {
    xs[i] = rnd();
    ys[i] = clamp(1 - (i + 0.5) / count + (rnd() - 0.5) * (0.9 / count), 0, 1);
    sizes[i] = 0.7 + rnd() * rnd() * 2.1;
  }
}
