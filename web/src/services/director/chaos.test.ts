import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAOS } from '@shared/index';
import { applyMod, ChaosLfo } from './chaos';

describe('director chaos', () => {
  it('applyMod folds at edges', () => {
    expect(applyMod(0.95, 0.2)).toBeLessThan(1);
    expect(applyMod(0.05, -0.2)).toBeGreaterThan(0);
  });

  it('respects pins and group toggles', () => {
    const lfo = new ChaosLfo(1);
    const out = lfo.step(0.05, { ...DEFAULT_CHAOS, form: false, harmony: false, rhythm: false, melody: false, tone: false }, 'Drift', new Set(['pace']));
    expect(out.pace).toBe(0);
    expect(Math.abs(out.build)).toBeLessThan(1e-4);
  });
});
