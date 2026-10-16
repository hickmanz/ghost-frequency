import { describe, expect, it } from 'vitest';
import { chance, int, mulberry32, pick, range, shuffle, stream, weightedPick } from './rng';

describe('rng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('different seeds give different sequences', () => {
    const a = Array.from({ length: 8 }, ((r) => () => r.next())(mulberry32(1)));
    const b = Array.from({ length: 8 }, ((r) => () => r.next())(mulberry32(2)));
    expect(a).not.toEqual(b);
  });

  it('stream() is reproducible and key-sensitive', () => {
    const seq = (...keys: Array<string | number>): number[] => {
      const r = stream(1984, ...keys);
      return [r.next(), r.next(), r.next()];
    };
    expect(seq('arp', 3, 4)).toEqual(seq('arp', 3, 4));
    expect(seq('arp', 3, 4)).not.toEqual(seq('arp', 3, 5));
    expect(seq('arp', 3, 4)).not.toEqual(seq('bass', 3, 4));
    expect(seq('arp', 3, 4)).not.toEqual(seq('arp', 4, 3));
    // string "1" and number 1 are different keys
    expect(seq('x', 1)).not.toEqual(seq('x', '1'));
    // different master seed
    expect(stream(1, 'a').next()).not.toBe(stream(2, 'a').next());
  });

  it('streams are independent: consuming one does not change another', () => {
    const chords1 = stream(7, 'chords', 0);
    const arp = stream(7, 'arp', 0);
    for (let i = 0; i < 50; i++) arp.next();
    const chords2 = stream(7, 'chords', 0);
    for (let i = 0; i < 5; i++) expect(chords1.next()).toBe(chords2.next());
  });

  it('helpers behave', () => {
    const r = stream(3, 'h');
    for (let i = 0; i < 200; i++) {
      const v = range(r, 2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
      const n = int(r, 1, 3);
      expect([1, 2, 3]).toContain(n);
    }
    expect(['a', 'b']).toContain(pick(r, ['a', 'b']));
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (chance(r, 0.25)) hits++;
    expect(hits / 4000).toBeGreaterThan(0.2);
    expect(hits / 4000).toBeLessThan(0.3);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 6000; i++) counts[weightedPick(r, [['a', 1], ['b', 2], ['c', 0]] as const)]++;
    expect(counts.c).toBe(0);
    expect(counts.b / counts.a).toBeGreaterThan(1.6);
    expect(counts.b / counts.a).toBeLessThan(2.5);
    expect(shuffle(r, [1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});
