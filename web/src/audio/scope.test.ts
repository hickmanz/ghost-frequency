import { describe, expect, it } from 'vitest';
import { SCOPE_SAMPLES, copyTriggerAligned, peakToMeter } from './scope';

const sine = (n: number, period: number, phase = 0, amp = 1): Float32Array => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * ((i + phase) / period));
  return a;
};

describe('copyTriggerAligned', () => {
  it('uses a 1024-sample window (documented sample count)', () => {
    expect(SCOPE_SAMPLES).toBe(1024);
  });

  it('starts the copy at a rising zero crossing', () => {
    const src = sine(2048, 100, 37); // phase offset => the raw buffer starts mid-cycle
    const dst = new Float32Array(1024);
    const start = copyTriggerAligned(src, dst);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(src[start - 1]!).toBeLessThan(0);
    expect(src[start]!).toBeGreaterThanOrEqual(0);
    expect(dst[0]).toBe(src[start]);
    expect(dst[1023]).toBe(src[start + 1023]);
    expect(dst[0]!).toBeLessThan(0.1); // starts near zero, going up
    expect(dst[3]!).toBeGreaterThan(dst[0]!);
  });

  it('gives the same picture for the same wave at different phases (stable scope)', () => {
    const dst1 = new Float32Array(512);
    const dst2 = new Float32Array(512);
    copyTriggerAligned(sine(2048, 128, 0), dst1);
    copyTriggerAligned(sine(2048, 128, 51), dst2);
    for (let i = 0; i < 512; i++) expect(dst1[i]!).toBeCloseTo(dst2[i]!, 1);
  });

  it('falls back to raw order for silence, DC and when src is too short', () => {
    const silent = new Float32Array(2048);
    silent[0] = 1e-7;
    const dst = new Float32Array(1024).fill(9);
    expect(copyTriggerAligned(silent, dst)).toBe(-1);
    expect(dst[0]).toBeCloseTo(1e-7, 10);
    expect(dst[5]).toBe(0);

    const dc = new Float32Array(2048).fill(0.5);
    expect(copyTriggerAligned(dc, dst)).toBe(-1);
    expect(dst[100]).toBe(0.5);

    const short = new Float32Array([0.1, 0.2, 0.3]);
    const d2 = new Float32Array(5).fill(7);
    expect(copyTriggerAligned(short, d2)).toBe(-1);
    expect(Array.from(d2).map((x) => Number(x.toFixed(2)))).toEqual([0.1, 0.2, 0.3, 0, 0]);
  });

  it('falls back to raw order when no crossing leaves room for a full window', () => {
    // rising crossing only in the last 10 samples of a buffer exactly as long as the window + 10
    const src = new Float32Array(1034).fill(-0.5);
    for (let i = 1030; i < 1034; i++) src[i] = 0.5;
    const dst = new Float32Array(1024);
    expect(copyTriggerAligned(src, dst)).toBe(-1);
    expect(dst[0]).toBe(-0.5);
  });

  it('ignores noise wiggles around zero before the signal arms (hysteresis)', () => {
    const src = new Float32Array(2048);
    for (let i = 0; i < 40; i++) src[i] = i % 2 === 0 ? 0.001 : -0.001; // tiny noise
    for (let i = 40; i < 2048; i++) src[i] = Math.sin((2 * Math.PI * (i - 40)) / 200);
    const dst = new Float32Array(1024);
    const start = copyTriggerAligned(src, dst);
    expect(start).toBeGreaterThanOrEqual(40); // the noise crossings did not trigger
  });

  it('handles an empty destination and never allocates a new array', () => {
    expect(copyTriggerAligned(new Float32Array(10), new Float32Array(0))).toBe(-1);
    const dst = new Float32Array(256);
    const before = dst.buffer;
    copyTriggerAligned(sine(1024, 64), dst);
    expect(dst.buffer).toBe(before);
  });

  it('survives NaN samples without throwing', () => {
    const src = sine(2048, 100);
    src[10] = Number.NaN;
    const dst = new Float32Array(1024);
    expect(() => copyTriggerAligned(src, dst)).not.toThrow();
  });
});

describe('peakToMeter', () => {
  it('maps -60 dB..0 dBFS to 0..1', () => {
    expect(peakToMeter(0)).toBe(0);
    expect(peakToMeter(1)).toBe(1);
    expect(peakToMeter(2)).toBe(1);
    expect(peakToMeter(0.5)).toBeCloseTo(1 - 20 * Math.log10(0.5) / -60, 6);
    expect(peakToMeter(0.001)).toBeCloseTo(0, 6);
    expect(peakToMeter(1e-6)).toBe(0);
    expect(peakToMeter(Number.NaN)).toBe(0);
  });
});
