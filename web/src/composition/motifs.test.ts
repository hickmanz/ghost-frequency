import { describe, expect, it } from 'vitest';
import { MOODS } from './moods';
import {
  augment,
  createHistory,
  createMotifBank,
  diminish,
  invert,
  ornament,
  rhythmicDisplace,
  selectMotifs,
  transposeToChord,
  truncate,
  varyMotif,
  type Motif,
} from './motifs';
import { stream } from './rng';
import { buildChord, mod12, scalePcs } from './theory';

const key = { tonic: 9, scale: 'aeolian' } as const;

function checkMotif(m: Motif): void {
  expect(m.notes.length).toBeGreaterThan(0);
  let end = 0;
  for (const n of m.notes) {
    expect(n.t).toBeGreaterThanOrEqual(end - 1e-9);
    expect(n.dur).toBeGreaterThan(0);
    expect((n.t * 4) % 1).toBe(0); // on the 16th grid
    expect((n.dur * 4) % 1).toBe(0);
    end = n.t + n.dur;
  }
  expect(end).toBeLessThanOrEqual(m.beats + 1e-9);
  expect(Number.isInteger(m.notes[0]!.step)).toBe(true);
}

describe('motifs', () => {
  it('banks are deterministic per seed and singable (mostly stepwise, end on chord tone)', () => {
    const a = createMotifBank(123, MOODS.nostalgic);
    const b = createMotifBank(123, MOODS.nostalgic);
    const c = createMotifBank(124, MOODS.nostalgic);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    let steps = 0;
    let leaps = 0;
    for (let seed = 0; seed < 60; seed++) {
      const bank = createMotifBank(seed, MOODS.dreamy);
      expect(bank.motifs.length).toBe(3);
      for (const m of bank.motifs) {
        checkMotif(m);
        const last = m.notes[m.notes.length - 1]!;
        expect([0, 2, 4]).toContain(((last.step % 7) + 7) % 7);
        for (let i = 1; i < m.notes.length; i++) {
          const d = Math.abs(m.notes[i]!.step - m.notes[i - 1]!.step);
          if (d <= 2) steps++;
          else leaps++;
        }
      }
    }
    expect(steps / (steps + leaps)).toBeGreaterThan(0.75);
  });

  it('variation operators return valid motifs', () => {
    for (let seed = 0; seed < 40; seed++) {
      const bank = createMotifBank(seed, MOODS.nostalgic);
      const rng = stream(seed, 'v');
      for (const m of bank.motifs) {
        for (const v of [
          rhythmicDisplace(m, rng),
          ornament(m, rng),
          truncate(m, 3),
          augment(m, 2),
          diminish(m, 2),
          invert(m),
          varyMotif(m, rng, 1),
        ]) {
          checkMotif(v);
        }
      }
    }
    const m = createMotifBank(5, MOODS.dark).motifs[0]!;
    expect(truncate(m, 2).notes.length).toBe(2);
    expect(invert(m).notes[0]!.step).toBe(m.notes[0]!.step);
  });

  it('transposeToChord stays in register, inside the scale/chord, and ends on a chord tone', () => {
    const pcs = scalePcs(key);
    for (let seed = 0; seed < 40; seed++) {
      const bank = createMotifBank(seed, MOODS.nostalgic);
      for (const m of bank.motifs) {
        for (const deg of [0, 3, 5, 6]) {
          const ch = buildChord(key, { degree: deg, color: 'triad', bars: 2 });
          const notes = transposeToChord(m, { key, chord: ch, register: [62, 84], center: 72 });
          expect(notes.length).toBeGreaterThan(0);
          for (const n of notes) {
            expect(n.midi).toBeGreaterThanOrEqual(62);
            expect(n.midi).toBeLessThanOrEqual(84);
            expect(pcs).toContain(mod12(n.midi));
          }
          const last = notes[notes.length - 1]!;
          expect(ch.pcs).toContain(mod12(last.midi));
        }
      }
    }
  });

  it('later sections reintroduce earlier motifs', () => {
    const mood = MOODS.nostalgic;
    const bank = createMotifBank(77, mood);
    const hist = createHistory();
    const seen = new Set<number>();
    let reintroduced = 0;
    for (let s = 0; s < 40; s++) {
      const ids = selectMotifs(bank, hist, stream(77, 'sel', s), s, mood);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      for (const id of ids) {
        if (seen.has(id) && s > 2) reintroduced++;
        seen.add(id);
      }
    }
    expect(reintroduced).toBeGreaterThan(10);
    expect(bank.motifs.length).toBeLessThanOrEqual(5);
  });
});
