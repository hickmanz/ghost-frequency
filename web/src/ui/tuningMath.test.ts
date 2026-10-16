import { describe, expect, it } from 'vitest';
import {
  LOG_STEPS,
  MAX_LINEAR_STEPS,
  decimalsForStep,
  formatValue,
  isModified,
  normToValue,
  resolveValue,
  roundToStep,
  sliderSteps,
  sliderToValue,
  valueToNorm,
  valueToOverride,
  valueToSlider,
  type ParamRange,
} from './tuningMath';

const lin: ParamRange = { min: 0, max: 1, step: 0.01 };
const log: ParamRange = { min: 200, max: 8000, step: 1, scale: 'log' };

describe('normToValue / valueToNorm', () => {
  it('maps linear endpoints and midpoint', () => {
    expect(normToValue(lin, 0)).toBe(0);
    expect(normToValue(lin, 1)).toBe(1);
    expect(normToValue(lin, 0.5)).toBeCloseTo(0.5, 10);
    expect(valueToNorm(lin, 0.25)).toBeCloseTo(0.25, 10);
  });

  it('maps log endpoints and geometric midpoint', () => {
    expect(normToValue(log, 0)).toBeCloseTo(200, 6);
    expect(normToValue(log, 1)).toBeCloseTo(8000, 6);
    expect(normToValue(log, 0.5)).toBeCloseTo(Math.sqrt(200 * 8000), 6);
    expect(valueToNorm(log, Math.sqrt(200 * 8000))).toBeCloseTo(0.5, 10);
  });

  it('round-trips log values', () => {
    for (const v of [200, 440, 1000, 3200, 8000]) {
      expect(normToValue(log, valueToNorm(log, v))).toBeCloseTo(v, 6);
    }
  });

  it('clamps out-of-range input', () => {
    expect(normToValue(lin, -3)).toBe(0);
    expect(normToValue(lin, 9)).toBe(1);
    expect(normToValue(lin, NaN)).toBe(0);
    expect(valueToNorm(lin, 5)).toBe(1);
    expect(valueToNorm(log, 1)).toBe(0);
  });

  it('falls back to linear when log is not usable (min <= 0)', () => {
    const bad: ParamRange = { min: 0, max: 100, step: 1, scale: 'log' };
    expect(normToValue(bad, 0.5)).toBeCloseTo(50, 10);
  });

  it('handles degenerate ranges', () => {
    const flat: ParamRange = { min: 3, max: 3, step: 1 };
    expect(normToValue(flat, 0.7)).toBe(3);
    expect(valueToNorm(flat, 3)).toBe(0);
  });
});

describe('slider positions', () => {
  it('uses step-count notches for linear and fixed notches for log', () => {
    expect(sliderSteps(lin)).toBe(100);
    expect(sliderSteps(log)).toBe(LOG_STEPS);
    expect(sliderSteps({ min: 0, max: 1, step: 0.00001 })).toBe(MAX_LINEAR_STEPS);
    expect(sliderSteps({ min: 0, max: 1, step: 0 })).toBe(MAX_LINEAR_STEPS);
  });

  it('maps endpoints exactly', () => {
    expect(sliderToValue(lin, 0)).toBe(0);
    expect(sliderToValue(lin, 100)).toBe(1);
    expect(sliderToValue(log, 0)).toBe(200);
    expect(sliderToValue(log, LOG_STEPS)).toBe(8000);
    expect(valueToSlider(log, 200)).toBe(0);
    expect(valueToSlider(log, 8000)).toBe(LOG_STEPS);
  });

  it('is monotonic for log positions', () => {
    let prev = -Infinity;
    for (let i = 0; i <= LOG_STEPS; i++) {
      const v = sliderToValue(log, i);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('log sliders spend equal travel per octave', () => {
    // 200 -> 400 and 2000 -> 4000 are both one octave.
    const a = valueToSlider(log, 400) - valueToSlider(log, 200);
    const b = valueToSlider(log, 4000) - valueToSlider(log, 2000);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it('round-trips linear positions without drift', () => {
    for (let pos = 0; pos <= 100; pos++) {
      expect(valueToSlider(lin, sliderToValue(lin, pos))).toBe(pos);
    }
  });

  it('round-trips log positions', () => {
    for (let pos = 0; pos <= LOG_STEPS; pos++) {
      expect(Math.abs(valueToSlider(log, sliderToValue(log, pos)) - pos)).toBeLessThanOrEqual(1);
    }
  });
});

describe('roundToStep', () => {
  it('snaps to the step grid and removes float noise', () => {
    expect(roundToStep(lin, 0.123)).toBe(0.12);
    expect(roundToStep({ min: 0, max: 1, step: 0.05 }, 0.3)).toBe(0.3);
    expect(roundToStep({ min: -12, max: 12, step: 0.5 }, 3.3)).toBe(3.5);
  });

  it('clamps and tolerates non-finite input', () => {
    expect(roundToStep(lin, 7)).toBe(1);
    expect(roundToStep(lin, -7)).toBe(0);
    expect(roundToStep(lin, NaN)).toBe(0);
  });

  it('anchors the grid at min and never exceeds max', () => {
    const p: ParamRange = { min: 0.1, max: 0.95, step: 0.2 };
    expect(roundToStep(p, 0.95)).toBeLessThanOrEqual(0.95);
    expect(roundToStep(p, 0.31)).toBeCloseTo(0.3, 10);
  });
});

describe('decimalsForStep', () => {
  it('counts decimals', () => {
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(10)).toBe(0);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.01)).toBe(2);
    expect(decimalsForStep(0.001)).toBe(3);
    expect(decimalsForStep(1e-7)).toBe(6);
    expect(decimalsForStep(0)).toBe(2);
  });
});

describe('isModified / valueToOverride / resolveValue', () => {
  it('treats no override as unmodified', () => {
    expect(isModified(lin, undefined, 0.5)).toBe(false);
    expect(isModified(lin, undefined, undefined)).toBe(false);
  });

  it('ignores differences below half a step', () => {
    expect(isModified(lin, 0.5, 0.5)).toBe(false);
    expect(isModified(lin, 0.504, 0.5)).toBe(false);
    expect(isModified(lin, 0.51, 0.5)).toBe(true);
  });

  it('counts an override with unknown default as modified', () => {
    expect(isModified(lin, 0.3, undefined)).toBe(true);
  });

  it('drops overrides that land back on the default', () => {
    expect(valueToOverride(lin, 0.5, 0.5)).toBeUndefined();
    expect(valueToOverride(lin, 0.6, 0.5)).toBe(0.6);
    expect(valueToOverride(lin, 0.6, undefined)).toBe(0.6);
  });

  it('resolves override ?? default ?? min', () => {
    expect(resolveValue(lin, 0.7, 0.5)).toBe(0.7);
    expect(resolveValue(lin, undefined, 0.5)).toBe(0.5);
    expect(resolveValue(lin, undefined, undefined)).toBe(0);
    expect(resolveValue(log, undefined, undefined)).toBe(200);
  });
});

describe('formatValue', () => {
  it('formats with step-derived decimals and units', () => {
    expect(formatValue({ step: 0.01 }, 0.35)).toBe('0.35');
    expect(formatValue({ step: 1, unit: 'ms' }, 120)).toBe('120 ms');
    expect(formatValue({ step: 1, unit: 'Hz' }, 440)).toBe('440 Hz');
    expect(formatValue({ step: 1, unit: 'st' }, 7)).toBe('7 st');
  });

  it('formats percent / multiplier without a space', () => {
    expect(formatValue({ step: 1, unit: '%' }, 40)).toBe('40%');
    expect(formatValue({ step: 0.1, unit: '\u00d7' }, 1.5)).toBe('1.5\u00d7');
  });

  it('switches Hz to kHz at 1000', () => {
    expect(formatValue({ step: 1, unit: 'Hz' }, 1200)).toBe('1.2 kHz');
    expect(formatValue({ step: 1, unit: 'Hz' }, 8000)).toBe('8 kHz');
  });

  it('handles non-finite values', () => {
    expect(formatValue({ step: 1 }, NaN)).toBe('-');
  });
});
