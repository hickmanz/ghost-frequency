import { describe, expect, it } from 'vitest';
import { MOOD_IDS } from '@shared/index';
import { TUNING_SCHEMA } from './params';
import { getDefaultValue } from './defaults';

const allParams = TUNING_SCHEMA.flatMap((g) => g.params);

describe('TUNING_SCHEMA', () => {
  it('has the groups in the agreed order with friendly labels', () => {
    expect(TUNING_SCHEMA.map((g) => g.id)).toEqual(['arp', 'lead', 'pad', 'bass', 'drums', 'texture', 'fx']);
    expect(TUNING_SCHEMA.map((g) => g.label)).toEqual([
      'Arpeggio', 'Lead', 'Pad', 'Bass', 'Percussion', 'Ambient Texture', 'Space (Reverb & Delay)',
    ]);
  });

  it('has unique keys, each under its own group prefix', () => {
    const keys = allParams.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of TUNING_SCHEMA) for (const p of g.params) expect(p.key.startsWith(`${g.id}.`)).toBe(true);
  });

  it('has sane metadata', () => {
    for (const p of allParams) {
      expect(p.label.length).toBeGreaterThan(2);
      expect(p.hint.length).toBeGreaterThan(10);
      expect(p.max).toBeGreaterThan(p.min);
      expect(p.step).toBeGreaterThan(0);
      if (p.kind !== 'choice') expect(p.step).toBeLessThan(p.max - p.min);
      if (p.scale === 'log') expect(p.min).toBeGreaterThan(0);
    }
  });

  it('respects the safety limits', () => {
    for (const p of allParams) {
      if (p.unit === 'Hz' && p.scale === 'log' && /cutoff|ceilingHz|LpHz|HpHz/i.test(p.key)) expect(p.min).toBeGreaterThanOrEqual(80);
      if (/\.q$|Q$/.test(p.key)) expect(p.max).toBeLessThanOrEqual(6);
    }
    const fb = allParams.find((p) => p.key === 'fx.delayFeedback')!;
    expect(fb.max).toBeLessThanOrEqual(0.58);
    for (const p of allParams.filter((x) => /Send\./.test(x.key))) {
      expect(p.min).toBe(0);
      expect(p.max).toBeLessThanOrEqual(1);
    }
  });

  for (const mood of MOOD_IDS) {
    it(`every key resolves to a finite number inside [min,max] in "${mood}"`, () => {
      for (const p of allParams) {
        const v = getDefaultValue(mood, p.key);
        expect(v, `${mood}:${p.key}`).toBeTypeOf('number');
        expect(Number.isFinite(v), `${mood}:${p.key}`).toBe(true);
        expect(v!, `${mood}:${p.key} >= min`).toBeGreaterThanOrEqual(p.min);
        expect(v!, `${mood}:${p.key} <= max`).toBeLessThanOrEqual(p.max);
      }
    });
  }
});
