import { afterEach, describe, expect, it } from 'vitest';
import { MOOD_IDS } from '@shared/index';
import { PRESETS, WAVES, getPreset, sanitizeOverrides, setTuningOverrides, snapChoice, type MoodPreset } from '../audio/presets';
import { formatOverridesForCopy, getChoiceLabel, getDefaultValue, formatTuningValue } from './defaults';
import { TUNING_SCHEMA } from './params';

const allParams = TUNING_SCHEMA.flatMap((g) => g.params);
const byKey = new Map(allParams.map((p) => [p.key, p]));
const choices = allParams.filter((p) => p.kind === 'choice');

const CHOICE_KEYS = ['arp.wave', 'lead.wave0', 'lead.wave1', 'pad.baseType', 'bass.wave', 'bass.subWave', 'texture.droneBaseType'];
const UNISON_KEYS = ['arp.unison', 'lead.unison0', 'pad.unison'];

const at = (root: unknown, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root);

afterEach(() => {
  for (const m of MOOD_IDS) setTuningOverrides(m, {});
});

describe('wave choice schema', () => {
  it('exposes exactly the agreed choice keys and unison sliders, once each', () => {
    expect(choices.map((c) => c.key).sort()).toEqual([...CHOICE_KEYS].sort());
    const keys = allParams.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of UNISON_KEYS) {
      const prm = byKey.get(k)!;
      expect(prm.kind ?? 'slider').toBe('slider');
      expect(prm.step).toBe(1);
      expect(prm.min).toBe(1);
    }
    expect(byKey.get('arp.unison')!.max).toBe(5);
    expect(byKey.get('lead.unison0')!.max).toBe(4);
    expect(byKey.get('pad.unison')!.max).toBe(5);
  });

  it('describes every choice completely (options, hints, wave visual, plain-language text)', () => {
    for (const c of choices) {
      expect(c.options!.length, c.key).toBeGreaterThanOrEqual(2);
      expect(c.visual, c.key).toBe('wave');
      expect(c.step).toBe(1);
      expect(c.hint.length).toBeGreaterThan(20);
      const values = c.options!.map((o) => o.value);
      expect(new Set(values).size, c.key).toBe(values.length);
      expect(c.min).toBe(Math.min(...values));
      expect(c.max).toBe(Math.max(...values));
      for (const o of c.options!) {
        expect(o.label.length).toBeGreaterThan(2);
        expect(WAVES as readonly string[], `${c.key}:${o.label}`).toContain(o.wave);
        // value is the index in WAVES
        expect(WAVES[o.value]).toBe(o.wave);
      }
    }
  });

  it('offers the intended option sets', () => {
    const labels = (k: string) => byKey.get(k)!.options!.map((o) => o.label);
    for (const k of ['arp.wave', 'lead.wave0', 'lead.wave1', 'pad.baseType', 'texture.droneBaseType']) {
      expect(labels(k), k).toEqual(['Sine', 'Triangle', 'Sawtooth', 'Square']);
    }
    expect(labels('bass.wave')).toEqual(['Triangle', 'Sawtooth', 'Square']);
    expect(labels('bass.subWave')).toEqual(['Sine', 'Triangle']);
  });

  it('marks envelope and filter parameters with a visual hint', () => {
    for (const k of ['arp.attack', 'arp.decay', 'arp.release', 'lead.attack', 'lead.release', 'pad.attack', 'pad.release', 'bass.ampDecay']) {
      expect(byKey.get(k)!.visual, k).toBe('envelope');
    }
    for (const k of [
      'arp.cutoffMax', 'arp.cutoffMin', 'arp.q', 'arp.filterOctaves', 'arp.filterDecay', 'lead.cutoffMax', 'lead.cutoffMin',
      'pad.cutoffMax', 'pad.cutoffMin', 'bass.cutoffMax', 'bass.cutoffMin', 'bass.filterOctaves', 'texture.droneCutoffMax',
      'texture.droneCutoffMin',
    ]) {
      expect(byKey.get(k)!.visual, k).toBe('filter');
    }
    // units / scales of the touched entries are preserved
    expect(byKey.get('arp.cutoffMax')!.unit).toBe('Hz');
    expect(byKey.get('arp.cutoffMax')!.scale).toBe('log');
    expect(byKey.get('arp.release')!.unit).toBe('s');
  });
});

describe('wave choice defaults', () => {
  for (const mood of MOOD_IDS) {
    it(`every new key resolves in "${mood}" and its default lies inside the option set / range`, () => {
      const preset: MoodPreset = PRESETS[mood];
      for (const k of [...CHOICE_KEYS, ...UNISON_KEYS]) {
        expect(at(preset, k), `${mood}:${k}`).toBeDefined();
        const prm = byKey.get(k)!;
        const v = getDefaultValue(mood, k);
        expect(v, `${mood}:${k}`).toBeTypeOf('number');
        if (prm.kind === 'choice') expect(prm.options!.map((o) => o.value), `${mood}:${k}`).toContain(v);
        else {
          expect(v!).toBeGreaterThanOrEqual(prm.min);
          expect(v!).toBeLessThanOrEqual(prm.max);
        }
      }
    });
  }

  it('the default options reproduce the current sounds (saw stacks, saw+saw lead, saw+sine bass, per-mood pad/drone)', () => {
    for (const mood of MOOD_IDS) {
      const p = PRESETS[mood];
      expect(p.arp.wave).toBe('sawtooth');
      expect(p.arp.unison).toBe(3);
      expect(p.lead.wave0).toBe('sawtooth');
      expect(p.lead.unison0).toBe(2);
      expect(p.lead.wave1).toBe('sawtooth');
      expect(p.pad.unison).toBe(3);
      expect(p.bass.wave).toBe('sawtooth');
      expect(p.bass.subWave).toBe('sine');
      const spaceish = mood === 'space' ? 'triangle' : 'sawtooth';
      expect(p.pad.baseType).toBe(spaceish);
      expect(p.texture.droneBaseType).toBe(spaceish);
      // numeric defaults
      expect(getDefaultValue(mood, 'arp.wave')).toBe(2);
      expect(getDefaultValue(mood, 'bass.subWave')).toBe(0);
      expect(getDefaultValue(mood, 'pad.baseType')).toBe(mood === 'space' ? 1 : 2);
      expect(getDefaultValue(mood, 'lead.unison0')).toBe(2);
      // no overrides -> the merged preset IS the built-in one
      expect(getPreset(mood)).toBe(PRESETS[mood]);
    }
  });
});

describe('sanitizeOverrides for choices and unison', () => {
  it('accepts valid option values, rounds to the nearest integer option, ignores everything else', () => {
    const out = sanitizeOverrides({
      'arp.wave': 3,
      'lead.wave0': 0,
      'lead.wave1': 1.4, // rounds to 1
      'pad.baseType': 2.6, // rounds to 3
      'bass.wave': 1,
      'bass.subWave': 1,
    });
    expect(out).toEqual({ 'arp.wave': 3, 'lead.wave0': 0, 'lead.wave1': 1, 'pad.baseType': 3, 'bass.wave': 1, 'bass.subWave': 1 });
    const bad = sanitizeOverrides({
      'arp.wave': 4, // no such option
      'lead.wave0': -1,
      'pad.baseType': 99,
      'bass.wave': 0, // sine is not offered for the bass
      'bass.subWave': 2, // sawtooth is not offered for the sub
      'texture.droneBaseType': Number.NaN,
      'lead.wave1': Number.POSITIVE_INFINITY,
    });
    expect(bad).toEqual({});
  });

  it('snapChoice rounds half up and rejects values that are not (near) an option', () => {
    const bass = byKey.get('bass.wave')!;
    expect(snapChoice(bass, 1.49)).toBe(1);
    expect(snapChoice(bass, 1.5)).toBe(2);
    expect(snapChoice(bass, 0.4)).toBeUndefined(); // rounds to 0 = sine: not offered
    expect(snapChoice(bass, 3.4)).toBe(3);
    expect(snapChoice(bass, 3.6)).toBeUndefined(); // rounds to 4
  });

  it('clamps and rounds the unison counts', () => {
    expect(sanitizeOverrides({ 'arp.unison': 3.7, 'lead.unison0': 9, 'pad.unison': 0 })).toEqual({
      'arp.unison': 4,
      'lead.unison0': 4,
      'pad.unison': 1,
    });
    expect(sanitizeOverrides({ 'arp.unison': 5.2 })['arp.unison']).toBe(5);
  });

  it('does not let a string-typed preset field be written through a non-choice key', () => {
    expect(sanitizeOverrides({ 'arp.nope': 1, 'pad.baseTypeX': 1, 'fx.reverbSend': 1 })).toEqual({});
  });
});

describe('merge: option value -> preset wave string (the single mapping place)', () => {
  it('maps every option of every choice key to its wave string in every mood, without touching PRESETS', () => {
    const before = JSON.stringify(PRESETS);
    for (const mood of MOOD_IDS) {
      for (const c of choices) {
        for (const o of c.options!) {
          setTuningOverrides(mood, { [c.key]: o.value });
          expect(at(getPreset(mood), c.key), `${mood}:${c.key}=${o.label}`).toBe(o.wave);
        }
      }
    }
    expect(JSON.stringify(PRESETS)).toBe(before);
  });

  it('applies several oscillator overrides together and leaves siblings alone', () => {
    setTuningOverrides('dreamy', { 'arp.wave': 3, 'arp.unison': 5, 'pad.baseType': 0, 'bass.subWave': 1, 'lead.unison0': 1 });
    const p = getPreset('dreamy');
    expect(p.arp.wave).toBe('square');
    expect(p.arp.unison).toBe(5);
    expect(p.pad.baseType).toBe('sine');
    expect(p.bass.subWave).toBe('triangle');
    expect(p.lead.unison0).toBe(1);
    expect(p.lead.wave0).toBe('sawtooth');
    expect(p.bass.wave).toBe('sawtooth');
    expect(getPreset('dark')).toBe(PRESETS.dark);
  });

  it('ignores invalid choice values (preset keeps its wave)', () => {
    setTuningOverrides('space', { 'pad.baseType': 7, 'bass.wave': 0, 'arp.wave': Number.NaN });
    expect(getPreset('space')).toBe(PRESETS.space);
  });

  it('getDefaultValue is not affected by overrides', () => {
    setTuningOverrides('space', { 'pad.baseType': 3 });
    expect(getDefaultValue('space', 'pad.baseType')).toBe(1);
  });
});

describe('copy format uses option labels', () => {
  it('prints labels for choices and numbers for sliders, JSON keeps the numeric values', () => {
    const text = formatOverridesForCopy('dreamy', { 'arp.wave': 3, 'arp.unison': 5, 'bass.wave': 1, 'pad.baseType': 2 });
    const lines = text.split('\n');
    expect(lines[1]).toBe('Mood: dreamy');
    expect(lines[2]).toBe('arp.wave: Sawtooth -> Square');
    expect(lines[3]).toBe('arp.unison: 3 -> 5');
    expect(lines[4]).toBe('bass.wave: Sawtooth -> Triangle');
    expect(lines[5]).toBe('JSON: {"arp.wave":3,"arp.unison":5,"bass.wave":1}'); // pad.baseType 2 == default: skipped
    expect(lines.length).toBe(6);
  });

  it('shows the label of the (per-mood) default and snaps like the engine', () => {
    const text = formatOverridesForCopy('space', { 'pad.baseType': 3.2, 'texture.droneBaseType': 9, 'bass.subWave': 0 });
    expect(text).toContain('pad.baseType: Triangle -> Square');
    expect(text).not.toContain('droneBaseType'); // invalid value ignored
    expect(text).not.toContain('subWave'); // equals the default
  });
});

describe('labels', () => {
  it('getChoiceLabel / formatTuningValue', () => {
    expect(getChoiceLabel('arp.wave', 2)).toBe('Sawtooth');
    expect(getChoiceLabel('bass.subWave', 0)).toBe('Sine');
    expect(getChoiceLabel('arp.wave', 9)).toBeUndefined();
    expect(getChoiceLabel('arp.cutoffMax', 2)).toBeUndefined();
    expect(formatTuningValue('arp.unison', 4)).toBe('4');
    expect(formatTuningValue('texture.droneBaseType', 3)).toBe('Square');
  });
});
