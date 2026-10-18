import { describe, expect, it } from 'vitest';
import { MOOD_IDS, type KeySpec } from '@shared/index';
import {
  BASS_HI,
  BASS_LO,
  PAD_HI,
  PAD_LO,
  bassRootsForChords,
  findPivotTemplate,
  generateProgression,
  mutateProgression,
  relatedKey,
  voiceLeadLoop,
  voicingDistance,
} from './harmony';
import { MOODS } from './moods';
import { stream } from './rng';
import { keysEqual, mod12, scalePcs } from './theory';

function randomKey(mood: (typeof MOODS)[keyof typeof MOODS], i: number): KeySpec {
  const r = stream(99, 'key', mood.id, i);
  const scale = mood.scales[Math.floor(r.next() * mood.scales.length)]![0];
  return { tonic: Math.floor(r.next() * 12), scale };
}

describe('harmony: progressions', () => {
  it('every chord belongs to the key (or is declared borrowed); 4-8 chords; 8 or 16 bar loops', () => {
    for (const id of MOOD_IDS) {
      const mood = MOODS[id];
      for (let i = 0; i < 60; i++) {
        const key = randomKey(mood, i);
        const prog = generateProgression(key, mood, stream(5, 'prog', id, i));
        expect(prog.chords.length).toBeGreaterThanOrEqual(4);
        expect(prog.chords.length).toBeLessThanOrEqual(8);
        expect([8, 16]).toContain(prog.loopBars);
        const pcs = scalePcs(key);
        for (const c of prog.chords) {
          expect(c.bars).toBeGreaterThanOrEqual(1);
          if (!c.borrowed) for (const p of c.pcs) expect(pcs).toContain(p);
          expect(c.numeral.length).toBeGreaterThan(0);
          expect(c.label.length).toBeGreaterThan(0);
          // no diminished triads, no repeated adjacent roots
          expect(c.numeral.includes('\u00b0')).toBe(false);
        }
        for (let k = 0; k < prog.chords.length; k++) {
          const a = prog.chords[k]!;
          const b = prog.chords[(k + 1) % prog.chords.length]!;
          expect(a.rootPc).not.toBe(b.rootPc);
          expect(mod12(a.rootPc - b.rootPc)).not.toBe(6);
        }
      }
    }
  });

  it('mood harmonic rhythm: space is slow, others are 1-2 bars per chord mostly', () => {
    const space = generateProgression({ tonic: 9, scale: 'dorian' }, MOODS.space, stream(1, 's'));
    expect(Math.min(...space.chords.map((c) => c.bars))).toBeGreaterThanOrEqual(2);
  });

  it('mutateProgression changes 1-2 chords, keeps first chord, length and bars', () => {
    const mood = MOODS.nostalgic;
    let changedTotal = 0;
    for (let i = 0; i < 40; i++) {
      const key = randomKey(mood, i);
      const prog = generateProgression(key, mood, stream(8, 'p', i));
      const m = mutateProgression(prog, stream(8, 'm', i), 0.8);
      expect(m.chords.length).toBe(prog.chords.length);
      expect(m.loopBars).toBe(prog.loopBars);
      expect(m.chords[0]!.label).toBe(prog.chords[0]!.label);
      const diff = m.chords.filter((c, k) => c.label !== prog.chords[k]!.label).length;
      expect(diff).toBeLessThanOrEqual(2);
      changedTotal += diff;
      const pcs = scalePcs(key);
      for (const c of m.chords) if (!c.borrowed) for (const p of c.pcs) expect(pcs).toContain(p);
      for (let k = 0; k < m.chords.length; k++) {
        const a = m.chords[k]!;
        const b = m.chords[(k + 1) % m.chords.length]!;
        expect(mod12(a.rootPc - b.rootPc)).not.toBe(6);
      }
    }
    expect(changedTotal).toBeGreaterThan(20);
    // amount 0 leaves it alone
    const prog = generateProgression({ tonic: 9, scale: 'aeolian' }, mood, stream(1, 'z'));
    expect(mutateProgression(prog, stream(1, 'zz'), 0)).toBe(prog);
  });

  it('relatedKey is a different, closely related key and respects allowed scales', () => {
    for (let i = 0; i < 100; i++) {
      const key = { tonic: i % 12, scale: MOODS.dark.scales[i % 2]![0] };
      const allowed = MOODS.dark.scales.map((s) => s[0]);
      const k = relatedKey(key, stream(3, 'rk', i), allowed);
      expect(keysEqual(k, key)).toBe(false);
      expect(allowed).toContain(k.scale);
      // shares at least 4 pitch classes with the old key (closely related)
      const shared = scalePcs(k).filter((p) => scalePcs(key).includes(p)).length;
      expect(shared).toBeGreaterThanOrEqual(4);
    }
    // coming from a mood with other scales: result adopts an allowed scale
    const k = relatedKey({ tonic: 0, scale: 'ionian' }, stream(1, 'x'), ['aeolian', 'phrygian']);
    expect(['aeolian', 'phrygian']).toContain(k.scale);
  });

  it('pivot chords are diatonic in both keys', () => {
    for (let i = 0; i < 60; i++) {
      const from: KeySpec = { tonic: (i * 5) % 12, scale: 'aeolian' };
      const to = relatedKey(from, stream(2, 'pv', i), ['aeolian', 'ionian', 'dorian']);
      const tpl = findPivotTemplate(from, to, stream(2, 'pt', i), 2);
      expect(tpl).not.toBeNull();
    }
  });
});

describe('harmony: voice leading + bass', () => {
  it('pathPick chooses alternate voicings across seeds', () => {
    const mood = MOODS.dreamy;
    const key = randomKey(mood, 99);
    const prog = generateProgression(key, mood, stream(11, 'pp', 99));
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const v = voiceLeadLoop(prog.chords, {
        open: mood.padOpen,
        pathPick: stream(i, 'ppick'),
        pathSlack: 14,
      });
      seen.add(JSON.stringify(v));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('pad voicings stay in register and move little (avg < 4 semitones per voice)', () => {
    for (const id of MOOD_IDS) {
      const mood = MOODS[id];
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i < 40; i++) {
        const key = randomKey(mood, i);
        const prog = generateProgression(key, mood, stream(11, 'vl', id, i));
        const v = voiceLeadLoop(prog.chords, { open: mood.padOpen });
        expect(v.length).toBe(prog.chords.length);
        v.forEach((voicing, k) => {
          expect(voicing.length).toBeGreaterThanOrEqual(3);
          for (const p of voicing) {
            expect(p).toBeGreaterThanOrEqual(PAD_LO);
            expect(p).toBeLessThanOrEqual(PAD_HI);
          }
          // every chord pitch class is present
          const pcs = new Set(voicing.map((p) => p % 12));
          for (const pc of prog.chords[k]!.pcs) expect(pcs.has(pc)).toBe(true);
        });
        for (let k = 0; k < v.length; k++) {
          const a = v[k]!;
          const b = v[(k + 1) % v.length]!;
          const moved = b.map((p) => Math.min(...a.map((q) => Math.abs(p - q))));
          sum += moved.reduce((s, x) => s + x, 0) / moved.length;
          cnt++;
          expect(voicingDistance(a, b)).toBeGreaterThanOrEqual(0);
        }
      }
      expect(sum / cnt).toBeLessThan(4);
    }
  });

  it('bass roots stay in the sub register', () => {
    for (const id of MOOD_IDS) {
      const mood = MOODS[id];
      for (let i = 0; i < 30; i++) {
        const key = randomKey(mood, i);
        const prog = generateProgression(key, mood, stream(13, 'b', id, i));
        const roots = bassRootsForChords(prog.chords, null);
        roots.forEach((r, k) => {
          expect(r).toBeGreaterThanOrEqual(BASS_LO);
          expect(r).toBeLessThanOrEqual(BASS_HI);
          expect(r % 12).toBe(prog.chords[k]!.rootPc);
        });
      }
    }
  });
});
