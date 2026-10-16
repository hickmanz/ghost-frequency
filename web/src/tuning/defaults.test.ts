import { afterEach, describe, expect, it } from 'vitest';
import { MOOD_IDS } from '@shared/index';
import { PRESETS, WAVES, getPreset, getTuningOverrides, setTuningOverrides } from '../audio/presets';
import { formatOverridesForCopy, getBuiltinPreset, getDefaultValue } from './defaults';
import { TUNING_SCHEMA } from './params';

const clearAll = (): void => {
  for (const m of MOOD_IDS) setTuningOverrides(m, {});
};
afterEach(clearAll);

describe('getDefaultValue / getBuiltinPreset', () => {
  it('returns built-in values by dotted key', () => {
    expect(getDefaultValue('dreamy', 'arp.cutoffMax')).toBe(4200);
    expect(getDefaultValue('space', 'fx.reverbSend.pad')).toBe(0.8);
    expect(getDefaultValue('dark', 'fx.delayFeedback')).toBe(0.38);
  });

  it('returns undefined for unknown / non-numeric / unsafe keys', () => {
    for (const k of ['', 'arp', 'arp.nope', 'nope.x', 'pad.nope', 'fx.reverbSend', 'fx.reverbSend.nope', '__proto__.x', 'arp.__proto__', 'arp.constructor']) {
      expect(getDefaultValue('dreamy', k), k).toBeUndefined();
    }
  });

  it('is not affected by overrides, and getBuiltinPreset is the PRESETS object', () => {
    setTuningOverrides('dreamy', { 'arp.cutoffMax': 6000 });
    expect(getDefaultValue('dreamy', 'arp.cutoffMax')).toBe(4200);
    expect(getBuiltinPreset('dreamy')).toBe(PRESETS.dreamy);
  });
});

describe('formatOverridesForCopy', () => {
  it('lists changed keys as "key: old -> new" in schema order, plus JSON', () => {
    const text = formatOverridesForCopy('dreamy', {
      'fx.delayFeedback': 0.5,
      'arp.cutoffMax': 6000,
      'lead.vibratoAmount': 0.18, // equal to default -> skipped
      'bogus.key': 3, // unknown -> skipped
      'arp.q': Number.NaN, // invalid -> skipped
    });
    const lines = text.split('\n');
    expect(lines[0]).toContain('Sound Lab');
    expect(lines[1]).toBe('Mood: dreamy');
    expect(lines[2]).toBe('arp.cutoffMax: 4200 -> 6000');
    expect(lines[3]).toBe('fx.delayFeedback: 0.42 -> 0.5');
    expect(lines[4]).toBe('JSON: {"arp.cutoffMax":6000,"fx.delayFeedback":0.5}');
    expect(lines.length).toBe(5);
  });

  it('shows the clamped value that the engine really uses', () => {
    const text = formatOverridesForCopy('dark', { 'fx.delayFeedback': 5 });
    expect(text).toContain('fx.delayFeedback: 0.38 -> 0.58');
  });

  it('says so when nothing changed', () => {
    expect(formatOverridesForCopy('space', {})).toContain('no changes');
  });
});

describe('overrides store (getPreset merge)', () => {
  it('returns the built-in object when there are no overrides', () => {
    expect(getPreset('dark')).toBe(PRESETS.dark);
  });

  it('merges dotted keys (incl. nested fx sends) without mutating PRESETS', () => {
    const before = JSON.stringify(PRESETS);
    setTuningOverrides('dreamy', { 'arp.cutoffMax': 6000, 'fx.reverbSend.arp': 0.9, 'lead.attack': 0.2 });
    const p = getPreset('dreamy');
    expect(p).not.toBe(PRESETS.dreamy);
    expect(p.arp.cutoffMax).toBe(6000);
    expect(p.fx.reverbSend.arp).toBe(0.9);
    expect(p.fx.reverbSend.pad).toBe(PRESETS.dreamy.fx.reverbSend.pad); // untouched siblings
    expect(p.lead.attack).toBe(0.2);
    expect(p.arp.cutoffMin).toBe(PRESETS.dreamy.arp.cutoffMin);
    expect(JSON.stringify(PRESETS)).toBe(before);
    // other moods are unaffected
    expect(getPreset('dark')).toBe(PRESETS.dark);
  });

  it('caches the merged object and invalidates on change', () => {
    setTuningOverrides('space', { 'pad.attack': 3 });
    const a = getPreset('space');
    expect(getPreset('space')).toBe(a);
    setTuningOverrides('space', { 'pad.attack': 4 });
    const b = getPreset('space');
    expect(b).not.toBe(a);
    expect(b.pad.attack).toBe(4);
    expect(a.pad.attack).toBe(3); // old snapshot untouched
  });

  it('REPLACES the overrides of a mood and an empty object clears them', () => {
    setTuningOverrides('dreamy', { 'arp.q': 2 });
    setTuningOverrides('dreamy', { 'lead.q': 2 });
    expect(getPreset('dreamy').arp.q).toBe(PRESETS.dreamy.arp.q);
    expect(getPreset('dreamy').lead.q).toBe(2);
    setTuningOverrides('dreamy', {});
    expect(getPreset('dreamy')).toBe(PRESETS.dreamy);
    expect(Object.keys(getTuningOverrides('dreamy'))).toHaveLength(0);
  });

  it('ignores unknown keys, non-numeric and non-finite values', () => {
    setTuningOverrides('dreamy', {
      'arp.nope': 1,
      nope: 1,
      'pad.baseType': 5, // string field in the preset
      'fx.reverbSend': 1, // object, not number
      'arp.q': Number.NaN,
      'arp.spread': Number.POSITIVE_INFINITY,
      'arp.chorusWet': '0.3' as unknown as number,
      '__proto__.polluted': 1,
      'constructor.prototype.x': 1,
    });
    expect(getPreset('dreamy')).toBe(PRESETS.dreamy);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('clamps schema keys to [min,max]', () => {
    setTuningOverrides('dark', {
      'arp.cutoffMax': 1e9,
      'arp.cutoffMin': 1,
      'fx.delayFeedback': 0.99,
      'fx.reverbSend.lead': -3,
      'arp.q': 100,
    });
    const p = getPreset('dark');
    const find = (k: string) => TUNING_SCHEMA.flatMap((g) => g.params).find((x) => x.key === k)!;
    expect(p.arp.cutoffMax).toBe(find('arp.cutoffMax').max);
    expect(p.arp.cutoffMin).toBe(find('arp.cutoffMin').min);
    expect(p.fx.delayFeedback).toBeLessThanOrEqual(0.58);
    expect(p.fx.reverbSend.lead).toBe(0);
    expect(p.arp.q).toBe(6);
  });

  it('keeps every cutoffMax clearly above its cutoffMin', () => {
    setTuningOverrides('nostalgic', { 'lead.cutoffMax': 1200, 'lead.cutoffMin': 2000, 'bass.cutoffMax': 300, 'bass.cutoffMin': 400 });
    const p = getPreset('nostalgic');
    expect(p.lead.cutoffMax).toBeGreaterThan(p.lead.cutoffMin);
    expect(p.bass.cutoffMax).toBeGreaterThan(p.bass.cutoffMin);
    expect(p.bass.cutoffMin).toBeGreaterThanOrEqual(80);
  });

  it('every schema key accepted at its extremes yields a finite, safe preset in every mood', () => {
    for (const mood of MOOD_IDS) {
      for (const g of TUNING_SCHEMA) {
        for (const prm of g.params) {
          for (const v of [prm.min, prm.max]) {
            setTuningOverrides(mood, { [prm.key]: v });
            const p = getPreset(mood);
            const got = prm.key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], p);
            // choice keys resolve to the preset's wave string, everything else to a finite number
            if (prm.kind === 'choice') expect(WAVES as readonly unknown[]).toContain(got);
            else expect(Number.isFinite(got)).toBe(true);
            expect(p.fx.delayFeedback).toBeLessThan(0.6);
            expect(p.arp.cutoffMin).toBeGreaterThanOrEqual(80);
          }
        }
      }
    }
  });
});
