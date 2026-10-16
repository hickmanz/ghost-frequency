import { describe, expect, it } from 'vitest';
import { MOOD_IDS } from '@shared/index';
import { STACK_LEVEL_DB, TRIM_MAX_DB, TRIM_MIN_DB, WAVE_LEVEL_DB, oscTrimDb, stackLevelDb, type OscFamily } from './oscTrim';
import { PRESETS, WAVES } from './presets';

const FAMILIES = Object.keys(WAVE_LEVEL_DB) as OscFamily[];

describe('oscTrimDb', () => {
  it('is exactly 0 dB for every mood\'s built-in configuration (current sounds unchanged)', () => {
    for (const mood of MOOD_IDS) {
      const p = PRESETS[mood];
      expect(oscTrimDb('arp', p.arp.wave, p.arp.unison, p.arp.wave, p.arp.unison)).toBe(0);
      expect(oscTrimDb('pad', p.pad.baseType, p.pad.unison, p.pad.baseType, p.pad.unison)).toBe(0);
      expect(oscTrimDb('lead0', p.lead.wave0, p.lead.unison0, p.lead.wave0, p.lead.unison0)).toBe(0);
      expect(oscTrimDb('lead1', p.lead.wave1, 1, p.lead.wave1, 1)).toBe(0);
      expect(oscTrimDb('bass', p.bass.wave, 1, p.bass.wave, 1)).toBe(0);
      expect(oscTrimDb('sub', p.bass.subWave, 1, p.bass.subWave, 1)).toBe(0);
      expect(oscTrimDb('drone', p.texture.droneBaseType, 2, p.texture.droneBaseType, 2)).toBe(0);
    }
  });

  it('is finite and inside the safety clamp for every family x wave x count', () => {
    for (const fam of FAMILIES) {
      for (const w of WAVES) {
        for (const rw of WAVES) {
          for (let n = 1; n <= 5; n++) {
            for (let rn = 1; rn <= 5; rn++) {
              const t = oscTrimDb(fam, w, n, rw, rn);
              expect(Number.isFinite(t)).toBe(true);
              expect(t).toBeGreaterThanOrEqual(TRIM_MIN_DB);
              expect(t).toBeLessThanOrEqual(TRIM_MAX_DB);
            }
          }
        }
      }
    }
  });

  it('never boosts by more than +4 dB (peak safety) and ignores the count of plain oscillators', () => {
    expect(TRIM_MAX_DB).toBeLessThanOrEqual(4);
    expect(oscTrimDb('bass', 'square', 1, 'sawtooth', 1)).toBe(oscTrimDb('bass', 'square', 5, 'sawtooth', 3));
    expect(oscTrimDb('sub', 'triangle', 1, 'sine', 1)).toBe(oscTrimDb('sub', 'triangle', 4, 'sine', 2));
  });

  it('compensates the stack size: a single oscillator is boosted, a bigger stack is cut (arp)', () => {
    expect(oscTrimDb('arp', 'sawtooth', 1, 'sawtooth', 3)).toBeGreaterThan(3);
    expect(oscTrimDb('arp', 'sawtooth', 5, 'sawtooth', 3)).toBeLessThan(-1);
    expect(oscTrimDb('arp', 'sawtooth', 3, 'sawtooth', 3)).toBe(0);
    // lead voice 0 (built-in 2 stacked)
    expect(oscTrimDb('lead0', 'sawtooth', 1, 'sawtooth', 2)).toBeCloseTo(1.9, 5);
  });

  it('equalises the waves: louder waves are cut, quieter ones boosted, relative to the built-in', () => {
    expect(oscTrimDb('arp', 'square', 3, 'sawtooth', 3)).toBeLessThan(-4);
    expect(oscTrimDb('arp', 'sine', 3, 'sawtooth', 3)).toBeLessThan(-3);
    expect(oscTrimDb('pad', 'sawtooth', 3, 'triangle', 3)).toBeCloseTo(1.4, 5); // space mood: saw is quieter than its triangle
    expect(oscTrimDb('sub', 'triangle', 1, 'sine', 1)).toBeGreaterThan(1);
  });

  it('is monotonic in the wave level and rounds fractional / invalid counts instead of producing NaN', () => {
    expect(stackLevelDb('arp', 2.6)).toBe(stackLevelDb('arp', 3));
    expect(stackLevelDb('arp', 99)).toBe(stackLevelDb('arp', 5));
    expect(Number.isFinite(stackLevelDb('pad', 0))).toBe(true);
    expect(Number.isFinite(oscTrimDb('arp', 'sawtooth', Number.NaN, 'sawtooth', 3))).toBe(true);
  });

  it('has a complete table for every family', () => {
    for (const fam of FAMILIES) {
      for (const w of WAVES) expect(Number.isFinite(WAVE_LEVEL_DB[fam][w])).toBe(true);
      expect(STACK_LEVEL_DB[fam]).toHaveLength(5);
    }
  });
});