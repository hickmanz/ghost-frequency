import type { ChaosParams } from '@shared/index';
import { ChaosLfo, MOD_KEYS } from './chaos';
import type { ModOffsets } from './effective';
import { useStore } from '../store';

const TICK_MS = 50;

export function startDirectorModulator(): { stop(): void } {
  let lfo = new ChaosLfo(useStore.getState().params.seed);
  let seed = useStore.getState().params.seed;
  let last = performance.now();

  const timer = setInterval(() => {
    const st = useStore.getState();
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!st.playing) return;
    if (st.params.seed !== seed) {
      seed = st.params.seed;
      lfo = new ChaosLfo(seed);
    }
    const chaos: ChaosParams = st.chaos;
    const pins = new Set(Object.keys(st.pins).filter((k) => st.pins[k]));
    const out = lfo.step(dt, chaos, st.now.sectionName, pins);
    const prev = st.mod;
    let changed = false;
    const next: ModOffsets = {};
    for (const t of MOD_KEYS) {
      const v = Math.round(out[t] * 1000) / 1000;
      if (v !== 0) next[t] = v;
      if ((prev[t] ?? 0) !== v) changed = true;
    }
    if (changed) st.setMod(next);
  }, TICK_MS);

  return { stop: () => clearInterval(timer) };
}
