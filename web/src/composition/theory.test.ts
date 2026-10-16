import { describe, expect, it } from 'vitest';
import {
  SCALE_INTERVALS,
  buildChord,
  chordLabel,
  foldIntoRange,
  keyLabel,
  midiToScaleIndex,
  nearestInPcs,
  nearestMidiWithPc,
  pcOf,
  scaleIndexToMidi,
  scalePcs,
  snapToScale,
} from './theory';
import { MOOD_IDS, type ScaleName } from '@shared/index';
import { MOODS } from './moods';

describe('theory', () => {
  it('scale tables are well-formed for all ScaleName values', () => {
    const names = Object.keys(SCALE_INTERVALS) as ScaleName[];
    expect(names.length).toBe(8);
    for (const n of names) {
      const s = SCALE_INTERVALS[n];
      expect(s.length).toBe(7);
      expect(s[0]).toBe(0);
      for (let i = 1; i < 7; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
      expect(s[6]!).toBeLessThan(12);
    }
    for (const mood of MOOD_IDS) for (const [s] of MOODS[mood].scales) expect(names).toContain(s);
  });

  it('key labels', () => {
    expect(keyLabel({ tonic: 9, scale: 'aeolian' })).toBe('A minor');
    expect(keyLabel({ tonic: 2, scale: 'dorian' })).toBe('D dorian');
    expect(keyLabel({ tonic: 5, scale: 'ionian' })).toBe('F major');
    expect(keyLabel({ tonic: 10, scale: 'aeolian' })).toBe('Bb minor');
    expect(keyLabel({ tonic: 6, scale: 'aeolian' })).toBe('F# minor');
  });

  it('chord labels', () => {
    const am = { tonic: 9, scale: 'aeolian' } as const;
    expect(buildChord(am, { degree: 0, color: 'triad', bars: 2 }).label).toBe('Am');
    expect(buildChord(am, { degree: 0, color: 'seventh', bars: 2 }).label).toBe('Am7');
    expect(buildChord(am, { degree: 0, color: 'ninth', bars: 2 }).label).toBe('Am9');
    expect(buildChord(am, { degree: 0, color: 'add9', bars: 2 }).label).toBe('Amadd9');
    expect(buildChord(am, { degree: 5, color: 'seventh', bars: 2 }).label).toBe('Fmaj7');
    expect(buildChord(am, { degree: 6, color: 'triad', bars: 2 }).label).toBe('G');
    expect(buildChord(am, { degree: 3, color: 'sus2', bars: 2 }).label).toBe('Dsus2');
    expect(buildChord(am, { degree: 3, color: 'sus4', bars: 2 }).label).toBe('Dsus4');
    expect(buildChord(am, { degree: 0, color: 'quartal', bars: 2 }).intervals).toEqual([0, 5, 10, 15]);
    expect(chordLabel(0, [0, 4, 7, 11, 14])).toBe('Cmaj9');
    expect(chordLabel(7, [0, 4, 7, 10])).toBe('G7');
    expect(buildChord(am, { degree: 0, color: 'triad', bars: 2 }).numeral).toBe('i');
    expect(buildChord(am, { degree: 5, color: 'triad', bars: 2 }).numeral).toBe('bVI');
    expect(buildChord(am, { degree: 6, color: 'triad', bars: 2 }).numeral).toBe('bVII');
  });

  it('diatonic chords stay in key for every scale/degree/colour; borrowed chords are flagged', () => {
    const colors = ['triad', 'seventh', 'add9', 'ninth', 'sus2', 'sus4', 'quartal'] as const;
    for (const scale of Object.keys(SCALE_INTERVALS) as ScaleName[]) {
      const key = { tonic: 3, scale };
      const pcs = scalePcs(key);
      for (let d = 0; d < 7; d++) {
        for (const color of colors) {
          const c = buildChord(key, { degree: d, color, bars: 1 });
          expect(c.borrowed).toBe(false);
          for (const p of c.pcs) expect(pcs).toContain(p);
          expect(c.intervals[0]).toBe(0);
        }
      }
    }
    const key = { tonic: 9, scale: 'ionian' } as const;
    const iv = buildChord(key, { offset: 5, quality: 'm', color: 'triad', bars: 1 });
    expect(iv.borrowed).toBe(true);
    expect(iv.numeral).toBe('iv');
  });

  it('pitch helpers', () => {
    expect(pcOf(61)).toBe(1);
    expect(nearestMidiWithPc(60, 7)).toBe(55);
    expect(nearestMidiWithPc(60, 5)).toBe(65);
    expect(nearestInPcs(61, [0, 7])).toBe(60);
    expect(foldIntoRange(30, 48, 76)).toBe(54);
    const key = { tonic: 0, scale: 'ionian' } as const;
    expect(scaleIndexToMidi(key, 0)).toBe(60);
    expect(scaleIndexToMidi(key, 7)).toBe(72);
    expect(scaleIndexToMidi(key, -1)).toBe(59);
    expect(midiToScaleIndex(key, 64)).toBe(2);
    expect(snapToScale(key, 61)).toBe(60);
  });
});
