import { describe, expect, it } from 'vitest';
import {
  RAMP_SIZE,
  SPEC_MAX_HZ,
  SPEC_MIN_HZ,
  buildColorRamp,
  buildRowMap,
  dbToColorIndex,
  freqToUnit,
  levelToMeter,
  packRgba,
  sampleRowDb,
  spectrogramGrid,
  unitToColorIndex,
  unitToFreq,
} from './spectrogramMath';

describe('dbToColorIndex', () => {
  it('maps range, clamps and handles non-finite', () => {
    expect(dbToColorIndex(-200)).toBe(0);
    expect(dbToColorIndex(-Infinity)).toBe(0);
    expect(dbToColorIndex(NaN)).toBe(0);
    expect(dbToColorIndex(0)).toBe(RAMP_SIZE - 1);
    expect(dbToColorIndex(-60, -100, -20)).toBe(unitToColorIndex(0.5));
  });
  it('is monotonic', () => {
    let prev = -1;
    for (let db = -100; db <= -20; db += 2) {
      const i = dbToColorIndex(db);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
});

describe('buildColorRamp', () => {
  it('goes from near-black to near-white', () => {
    const ramp = new Uint32Array(RAMP_SIZE);
    buildColorRamp(ramp, true);
    const lum = (p: number) => (p & 0xff) + ((p >>> 8) & 0xff) + ((p >>> 16) & 0xff);
    expect(lum(ramp[0]!)).toBeLessThan(40);
    expect(lum(ramp[RAMP_SIZE - 1]!)).toBeGreaterThan(700);
    expect(ramp[0]! >>> 24).toBe(255); // opaque
  });
  it('packs both endianness variants', () => {
    expect(packRgba(1, 2, 3, true)).toBe(0xff030201);
    expect(packRgba(1, 2, 3, false)).toBe(0x010203ff);
  });
});

describe('log frequency mapping', () => {
  it('maps ends and mid point', () => {
    expect(freqToUnit(SPEC_MIN_HZ)).toBe(0);
    expect(freqToUnit(SPEC_MAX_HZ)).toBe(1);
    expect(freqToUnit(10)).toBe(0);
    expect(freqToUnit(30000)).toBe(1);
    const mid = Math.sqrt(SPEC_MIN_HZ * SPEC_MAX_HZ);
    expect(freqToUnit(mid)).toBeCloseTo(0.5, 6);
  });
  it('round-trips', () => {
    for (const hz of [60, 100, 440, 1000, 8000]) expect(unitToFreq(freqToUnit(hz))).toBeCloseTo(hz, 6);
  });
  it('100/1k/10k are ordered on the axis', () => {
    expect(freqToUnit(100)).toBeLessThan(freqToUnit(1000));
    expect(freqToUnit(1000)).toBeLessThan(freqToUnit(10000));
  });
});

describe('buildRowMap / sampleRowDb', () => {
  const rows = 100;
  const binCount = 1024;
  const sr = 44100;
  const a = new Uint16Array(rows);
  const b = new Uint16Array(rows);
  const f = new Float32Array(rows);
  buildRowMap(rows, binCount, sr, a, b, f);

  it('keeps bins in range and non-decreasing', () => {
    for (let r = 0; r < rows; r++) {
      expect(b[r]!).toBeGreaterThanOrEqual(a[r]!);
      expect(b[r]!).toBeLessThan(binCount);
      if (r > 0) expect(a[r]!).toBeGreaterThanOrEqual(a[r - 1]!);
      expect(f[r]!).toBeGreaterThanOrEqual(0);
      expect(f[r]!).toBeLessThanOrEqual(1);
    }
  });
  it('low rows interpolate, high rows take the max over several bins', () => {
    expect(b[0]).toBe(a[0]);
    expect(b[rows - 1]! - a[rows - 1]!).toBeGreaterThan(2);
  });
  it('a single tone lands on the expected row', () => {
    const spec = new Float32Array(binCount).fill(-100);
    const nyq = sr / 2;
    const bin = Math.round((1000 * binCount) / nyq);
    spec[bin] = -20;
    let best = 0;
    let bestDb = -Infinity;
    for (let r = 0; r < rows; r++) {
      const db = sampleRowDb(spec, a, b, f, r);
      if (db > bestDb) {
        bestDb = db;
        best = r;
      }
    }
    const expected = Math.round(freqToUnit(1000) * (rows - 1));
    expect(Math.abs(best - expected)).toBeLessThanOrEqual(2);
  });
  it('does not produce NaN with -Infinity bins', () => {
    const spec = new Float32Array(binCount).fill(-Infinity);
    for (let r = 0; r < rows; r++) expect(Number.isNaN(sampleRowDb(spec, a, b, f, r))).toBe(false);
  });
});

describe('levelToMeter / spectrogramGrid', () => {
  it('meter scale', () => {
    expect(levelToMeter(0)).toBe(0);
    expect(levelToMeter(1)).toBe(1);
    expect(levelToMeter(0.001)).toBe(0);
    expect(levelToMeter(0.1)).toBeCloseTo(40 / 60, 6);
  });
  it('grid is bounded', () => {
    expect(spectrogramGrid(10, 10)).toEqual({ cols: 64, rows: 48 });
    expect(spectrogramGrid(5000, 5000)).toEqual({ cols: 640, rows: 256 });
  });
});
