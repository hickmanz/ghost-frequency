/** Lorenz chaos LFO for director offsets (pure, testable). */
import type { ChaosParams } from '@shared/index';

export type ModKey =
  | 'energy' | 'complexity' | 'variation' | 'contrast'
  | 'pace' | 'build' | 'motion' | 'colour' | 'swing' | 'busy' | 'sync' | 'feel' | 'lead' | 'recall' | 'register'
  | 'bright' | 'grit' | 'space' | 'wow' | 'crush';

export const MOD_KEYS: readonly ModKey[] = [
  'energy', 'complexity', 'variation', 'contrast',
  'pace', 'build', 'motion', 'colour', 'swing', 'busy', 'sync', 'feel', 'lead', 'recall', 'register',
  'bright', 'grit', 'space', 'wow', 'crush',
];

const DEPTH: Record<ModKey, number> = {
  energy: 0.35, complexity: 0.3, variation: 0.35, contrast: 0.25,
  pace: 0.3, build: 0.35, motion: 0.3, colour: 0.35, swing: 0.25, busy: 0.3, sync: 0.28, feel: 0.2,
  lead: 0.3, recall: 0.25, register: 0.2,
  bright: 0.35, grit: 0.25, space: 0.3, wow: 0.25, crush: 0.2,
};

const SMOOTH: Record<ModKey, number> = {
  energy: 2.5, complexity: 3, variation: 2.5, contrast: 4,
  pace: 3, build: 2.8, motion: 3, colour: 2.5, swing: 3, busy: 2.5, sync: 2.8, feel: 4,
  lead: 2.8, recall: 3.5, register: 3,
  bright: 1.2, grit: 1.5, space: 1.8, wow: 2, crush: 2,
};

const PROJ: Record<ModKey, readonly [number, number, number]> = {
  energy: [0.6, 0.7, -0.2], complexity: [-0.5, 0.4, -0.7], variation: [0.3, 0.3, 0.9], contrast: [0.2, -0.6, 0.5],
  pace: [0.4, 0.2, 0.7], build: [0.7, 0.3, -0.2], motion: [-0.3, 0.5, 0.6], colour: [0.5, -0.4, 0.3],
  swing: [-0.8, -0.3, -0.4], busy: [0.6, 0.5, 0.1], sync: [0.2, 0.7, -0.3], feel: [-0.4, 0.3, 0.5],
  lead: [0.3, 0.6, 0.2], recall: [-0.2, 0.4, 0.7], register: [0.5, 0.2, -0.5],
  bright: [0.9, 0.4, 0.3], grit: [0.2, -0.9, 0.3], space: [-0.4, -0.5, 0.7], wow: [-0.7, 0.2, 0.6], crush: [0.3, -0.5, 0.4],
};

const QUIET = new Set(['Intro', 'Breakdown', 'Outro']);
const BUSY = new Set(['Build', 'Peak']);

export function sectionBias(section: string): Partial<Record<ModKey, number>> {
  if (QUIET.has(section)) return { energy: -0.1, bright: -0.08, busy: -0.12, space: 0.1 };
  if (BUSY.has(section)) return { energy: 0.12, build: 0.1, busy: 0.1, bright: 0.06 };
  return {};
}

export const speedFor = (rate: number): number => 0.02 + Math.pow(Math.min(1, Math.max(0, rate)), 2) * 0.6;

export function applyMod(base: number, offset: number): number {
  let v = base + offset;
  if (v > 1) v = 2 - v;
  if (v < 0) v = -v;
  return Math.min(1, Math.max(0, v));
}

function groupOn(chaos: ChaosParams, key: ModKey): boolean {
  if (key === 'energy' || key === 'contrast') return true;
  if (['pace', 'build'].includes(key)) return chaos.form;
  if (['motion', 'colour'].includes(key)) return chaos.harmony;
  if (['swing', 'busy', 'sync', 'feel'].includes(key)) return chaos.rhythm;
  if (['lead', 'recall', 'register'].includes(key)) return chaos.melody;
  if (['bright', 'grit', 'space', 'wow', 'crush'].includes(key)) return chaos.tone;
  if (key === 'complexity' || key === 'variation') return chaos.harmony || chaos.rhythm;
  return true;
}

export class ChaosLfo {
  private x = 0.1;
  private y = 0;
  private z = 20;
  private readonly smoothed = new Map<ModKey, number>();

  constructor(seed = 1) {
    this.x = 0.1 + (seed % 97) / 50;
    this.y = ((seed * 7) % 31) / 10;
    for (let i = 0; i < 200; i++) this.integrate(0.01);
  }

  private integrate(dt: number): void {
    const sigma = 10;
    const rho = 28;
    const beta = 8 / 3;
    const dx = sigma * (this.y - this.x);
    const dy = this.x * (rho - this.z) - this.y;
    const dz = this.x * this.y - beta * this.z;
    this.x += dx * dt;
    this.y += dy * dt;
    this.z += dz * dt;
  }

  state(): [number, number, number] {
    return [this.x / 18, this.y / 24, (this.z - 24) / 16];
  }

  step(dt: number, chaos: ChaosParams, section: string, pins: ReadonlySet<string>): Record<ModKey, number> {
    const lt = speedFor(chaos.rate) * dt;
    const n = Math.max(1, Math.ceil(lt / 0.005));
    for (let i = 0; i < n; i++) this.integrate(lt / n);
    const [nx, ny, nz] = this.state();
    const bias = sectionBias(section);
    const amount = Math.min(1, Math.max(0, chaos.amount));
    const out = {} as Record<ModKey, number>;
    for (const t of MOD_KEYS) {
      if (pins.has(t)) {
        out[t] = 0;
        continue;
      }
      const on = groupOn(chaos, t);
      const [a, b, c] = PROJ[t];
      const signal = Math.tanh(1.4 * (a * nx + b * ny + c * nz));
      const target = on ? amount * (DEPTH[t] * signal + (bias[t] ?? 0)) : 0;
      const prev = this.smoothed.get(t) ?? 0;
      const k = 1 - Math.exp(-dt / SMOOTH[t]);
      const v = prev + (target - prev) * k;
      this.smoothed.set(t, v);
      out[t] = Math.abs(v) < 1e-4 ? 0 : v;
    }
    return out;
  }
}
