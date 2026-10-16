import { describe, expect, it } from 'vitest';
import { buildLogBins, dbToUnit, peakDb, smoothValue } from './visualizerMath';

describe('dbToUnit', () => {
  it('maps range and clamps', () => {
    expect(dbToUnit(-100)).toBe(0);
    expect(dbToUnit(-30)).toBe(1);
    expect(dbToUnit(0)).toBe(1);
    expect(dbToUnit(-65)).toBeCloseTo(0.5, 5);
    expect(dbToUnit(-Infinity)).toBe(0);
    expect(dbToUnit(NaN)).toBe(0);
  });
});

describe('smoothValue', () => {
  it('attacks faster than it decays', () => {
    const up = smoothValue(0, 1, 16, 40, 220);
    const down = 1 - smoothValue(1, 0, 16, 40, 220);
    expect(up).toBeGreaterThan(down);
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThan(1);
  });
  it('is stable at dt=0 and converges', () => {
    expect(smoothValue(0.3, 1, 0, 40, 220)).toBe(0.3);
    let v = 0;
    for (let i = 0; i < 200; i++) v = smoothValue(v, 1, 16, 40, 220);
    expect(v).toBeCloseTo(1, 3);
  });
});

describe('buildLogBins', () => {
  it('produces valid, monotonic, in-range bins', () => {
    for (const binCount of [64, 256, 1024, 2048]) {
      const bars = 48;
      const s = new Uint16Array(bars);
      const e = new Uint16Array(bars);
      buildLogBins(binCount, bars, s, e);
      for (let i = 0; i < bars; i++) {
        expect(s[i]!).toBeGreaterThanOrEqual(0);
        expect(e[i]!).toBeLessThanOrEqual(binCount);
        expect(e[i]!).toBeGreaterThan(s[i]!);
        if (i > 0) expect(s[i]!).toBeGreaterThanOrEqual(s[i - 1]!);
      }
      // upper bars should span more bins than lower bars (log spacing)
      expect(e[bars - 1]! - s[bars - 1]!).toBeGreaterThan(e[0]! - s[0]!);
    }
  });
  it('handles tiny spectra', () => {
    const s = new Uint16Array(8);
    const e = new Uint16Array(8);
    buildLogBins(4, 8, s, e);
    for (let i = 0; i < 8; i++) {
      expect(e[i]!).toBeLessThanOrEqual(4);
      expect(e[i]!).toBeGreaterThan(s[i]!);
    }
  });
});

describe('peakDb', () => {
  it('finds the max in range', () => {
    const a = Float32Array.from([-90, -40, -60, -20]);
    expect(peakDb(a, 0, 3)).toBe(-40);
    expect(peakDb(a, 2, 4)).toBe(-20);
  });
});
