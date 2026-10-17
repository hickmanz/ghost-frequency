import { describe, expect, it } from 'vitest';
import { MOOD_IDS } from '@shared/index';
import { fbm1D, fillRidgeTable, hash01, mulberry32, sampleTable, valueNoise1D } from './common';
import {
  BUILDING_COUNT,
  CROSSFADE_MS,
  PARTICLE_PALETTE,
  ParticlePool,
  RIDGE_TABLE_SIZE,
  THEMES,
  buildSkyline,
  buildStars,
  crossfadeWeight,
  decayImpulse,
  drumKind,
  paletteIndex,
  pitchCold,
  pitchSkyFrac,
  scrollSpeed,
  starIndexForPitch,
  stepCrossfade,
  themeFor,
  type Crossfade,
} from './landscapeMath';

describe('seeded noise', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('hash01 is stable and bounded', () => {
    expect(hash01(3, 4)).toBe(hash01(3, 4));
    expect(hash01(3, 4)).not.toBe(hash01(4, 3));
    for (let i = 0; i < 50; i++) {
      const v = hash01(i, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('value noise is tileable and bounded', () => {
    for (let x = -5; x < 20; x += 0.37) {
      const v = valueNoise1D(5, x, 8);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(valueNoise1D(5, x + 8, 8)).toBeCloseTo(v, 9);
      const f = fbm1D(5, x, 8, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(fbm1D(5, x + 8, 8, 4)).toBeCloseTo(f, 9);
    }
  });
  it('ridge tables wrap seamlessly and differ per seed', () => {
    const a = new Float32Array(RIDGE_TABLE_SIZE);
    const b = new Float32Array(RIDGE_TABLE_SIZE);
    fillRidgeTable(a, 1, 24, true);
    fillRidgeTable(b, 2, 24, true);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // last sample -> first sample step is as small as any interior step (periodic)
    expect(Math.abs(a[0]! - a[a.length - 1]!)).toBeLessThan(0.1);
    expect(sampleTable(a, 3.5)).toBeCloseTo((a[3]! + a[4]!) / 2, 6);
    expect(sampleTable(a, -1)).toBeCloseTo(a[a.length - 1]!, 6);
    expect(sampleTable(a, a.length + 2)).toBeCloseTo(a[2]!, 6);
  });
});

describe('themes', () => {
  it('has a theme for every mood and falls back to nostalgic', () => {
    for (const m of MOOD_IDS) expect(themeFor(m).id).toBe(m);
    expect(themeFor('bogus').id).toBe('nostalgic');
    expect(Object.keys(THEMES).sort()).toEqual([...MOOD_IDS].sort());
  });
});

describe('theme cross-fade', () => {
  it('progresses over ~3 s and settles', () => {
    const cf: Crossfade = { from: 'dreamy', to: 'dreamy', t: 1 };
    stepCrossfade(cf, 'dark', 16);
    expect(cf.to).toBe('dark');
    expect(cf.from).toBe('dreamy');
    expect(cf.t).toBe(0);
    for (let ms = 0; ms < CROSSFADE_MS; ms += 100) stepCrossfade(cf, 'dark', 100);
    expect(cf.t).toBeGreaterThan(0.99);
    stepCrossfade(cf, 'dark', 100);
    expect(cf.t).toBe(1);
    expect(crossfadeWeight(cf)).toBe(1);
    stepCrossfade(cf, 'dark', 1000);
    expect(cf.t).toBe(1);
  });
  it('weight is eased and monotonic', () => {
    const cf: Crossfade = { from: 'dreamy', to: 'dark', t: 0 };
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.1) {
      cf.t = t;
      const w = crossfadeWeight(cf);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });
  it('reversing keeps the mix continuous', () => {
    const cf: Crossfade = { from: 'dreamy', to: 'dark', t: 0.3 };
    const before = crossfadeWeight(cf); // weight of dark
    stepCrossfade(cf, 'dreamy', 0);
    expect(cf.from).toBe('dark');
    expect(cf.to).toBe('dreamy');
    expect(crossfadeWeight(cf)).toBeCloseTo(1 - before, 6);
  });
  it('a third mood mid-fade starts from the dominant theme', () => {
    const cf: Crossfade = { from: 'dreamy', to: 'dark', t: 0.8 };
    stepCrossfade(cf, 'space', 0);
    expect(cf.from).toBe('dark');
    expect(cf.to).toBe('space');
    expect(cf.t).toBe(0);
  });
});

describe('event interpretation', () => {
  it('maps drum midi numbers', () => {
    expect(drumKind(36)).toBe('kick');
    expect(drumKind(38)).toBe('snare');
    expect(drumKind(39)).toBe('snare');
    expect(drumKind(42)).toBe('hat');
    expect(drumKind(46)).toBe('hat');
    expect(drumKind(49)).toBe('crash');
    expect(drumKind(43)).toBe('tom');
    expect(drumKind(60)).toBe('none');
  });
  it('higher pitch = colder, higher in the sky, higher star index', () => {
    expect(pitchCold(36)).toBe(0);
    expect(pitchCold(200)).toBe(1);
    expect(pitchCold(48)).toBeLessThan(pitchCold(84));
    expect(paletteIndex(30)).toBe(0);
    expect(paletteIndex(120)).toBe(PARTICLE_PALETTE.length - 1);
    expect(pitchSkyFrac(84)).toBeLessThan(pitchSkyFrac(48)); // smaller = higher up
    let lowSum = 0;
    let highSum = 0;
    for (let salt = 0; salt < 50; salt++) {
      lowSum += starIndexForPitch(40, 160, salt);
      highSum += starIndexForPitch(90, 160, salt);
      const v = starIndexForPitch(200, 160, salt);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(159);
    }
    expect(highSum).toBeGreaterThan(lowSum);
  });
  it('scroll speed grows with tempo and energy and is bounded', () => {
    expect(scrollSpeed(140, 0.5)).toBeGreaterThan(scrollSpeed(80, 0.5));
    expect(scrollSpeed(100, 0.9)).toBeGreaterThan(scrollSpeed(100, 0.1));
    expect(scrollSpeed(0, 0.5)).toBeCloseTo(scrollSpeed(100, 0.5), 9); // unknown tempo -> default
    expect(scrollSpeed(1000, 5)).toBeLessThan(4);
  });
  it('impulse decay', () => {
    expect(decayImpulse(1, 0, 100)).toBe(1);
    expect(decayImpulse(1, 100, 100)).toBeCloseTo(Math.exp(-1), 9);
    expect(decayImpulse(0.0001, 10, 100)).toBe(0);
  });
});

describe('ParticlePool', () => {
  it('never exceeds capacity and recycles slots', () => {
    const pool = new ParticlePool(10);
    for (let i = 0; i < 100; i++) pool.spawn(0, i, i, 0, 0, 1000, 2, 1);
    expect(pool.alive()).toBe(10);
  });
  it('moves and expires particles', () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 0, 0, 0.1, -0.2, 100, 2, 3);
    pool.step(50);
    expect(pool.x[0]).toBeCloseTo(5, 5);
    expect(pool.y[0]).toBeCloseTo(-10, 5);
    expect(pool.alive()).toBe(1);
    pool.step(60);
    expect(pool.alive()).toBe(0);
  });
  it('prefers dead slots over overwriting live ones', () => {
    const pool = new ParticlePool(4);
    pool.spawn(0, 1, 0, 0, 0, 1000, 1, 0);
    pool.spawn(0, 2, 0, 0, 0, 10, 1, 0);
    pool.step(20); // second one dies
    pool.spawn(0, 3, 0, 0, 0, 1000, 1, 0);
    pool.spawn(0, 4, 0, 0, 0, 1000, 1, 0);
    expect(pool.alive()).toBe(3);
    pool.clear();
    expect(pool.alive()).toBe(0);
  });
});

describe('procedural geometry', () => {
  it('skyline is deterministic and bounded', () => {
    const a = buildSkyline(42, 800);
    const b = buildSkyline(42, 800);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(a.x.length).toBe(BUILDING_COUNT);
    expect(a.tileW).toBeGreaterThan(800);
    for (let i = 0; i < BUILDING_COUNT; i++) {
      expect(a.h[i]!).toBeGreaterThan(0);
      expect(a.h[i]!).toBeLessThanOrEqual(1);
      expect(a.w[i]!).toBeGreaterThan(0);
    }
    expect(Array.from(buildSkyline(43, 800).h)).not.toEqual(Array.from(a.h));
  });
  it('stars are normalised and ordered by height rank', () => {
    const n = 100;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const ss = new Float32Array(n);
    buildStars(7, n, xs, ys, ss);
    for (let i = 0; i < n; i++) {
      expect(xs[i]!).toBeGreaterThanOrEqual(0);
      expect(xs[i]!).toBeLessThan(1);
      expect(ys[i]!).toBeGreaterThanOrEqual(0);
      expect(ys[i]!).toBeLessThanOrEqual(1);
      expect(ss[i]!).toBeGreaterThan(0.5);
    }
    // higher index -> (on average) higher in the sky (smaller y)
    expect(ys[n - 1]!).toBeLessThan(ys[0]!);
  });
});
