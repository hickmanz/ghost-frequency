import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, DRUM_KIT_IDS } from '@shared/index';
import { planSong, SongStream, songTempo } from './songPlan';

describe('SongStream', () => {
  it('plans deterministic songs for a seed', () => {
    const p = { ...DEFAULT_PARAMS, seed: 42 };
    const a = planSong(42, 0, 0, p);
    const b = planSong(42, 0, 0, p);
    expect(a.title).toBe(b.title);
    expect(a.tempo).toBe(b.tempo);
    expect(a.key).toEqual(b.key);
  });

  it('consecutive songs differ in tempo and palette', () => {
    const p = { ...DEFAULT_PARAMS, seed: 99, contrast: 0.9 };
    const s0 = planSong(99, 0, 0, p);
    const s1 = planSong(99, 1, s0.startBar + s0.lengthBars, p, s0);
    expect(Math.abs(s1.tempo - s0.tempo)).toBeGreaterThanOrEqual(4);
    expect(s1.palette.paletteId).not.toBe(s0.palette.paletteId);
  });

  it('sectionForBar covers bar ranges', () => {
    const stream = new SongStream(7);
    const p = { ...DEFAULT_PARAMS, seed: 7 };
    const { plan, song } = stream.sectionForBar(0, p);
    expect(plan.startBar).toBe(song.startBar);
    expect(plan.songIndex).toBe(0);
  });

  it('songTempo rises with energy', () => {
    const p = { ...DEFAULT_PARAMS, seed: 5 };
    const song = planSong(5, 0, 0, p);
    expect(songTempo(song, 1)).toBeGreaterThanOrEqual(songTempo(song, 0.5) + 16);
    expect(songTempo(song, 0)).toBeLessThanOrEqual(songTempo(song, 0.5) - 16);
  });

  it('high energy reaches the first peak sooner', () => {
    const barsToPeak = (energy: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const song = planSong(seed, 0, 0, { ...DEFAULT_PARAMS, seed, energy });
        let bars = 0;
        for (const slot of song.schedule) {
          if (slot.name === 'Peak') break;
          bars += slot.bars;
        }
        total += bars;
      }
      return total / 40;
    };
    expect(barsToPeak(1)).toBeLessThan(barsToPeak(0.5) * 0.75);
  });

  it('each song carries a drum family, swing in range and a kit in its palette', () => {
    const styles = new Set<string>();
    const kits = new Set<number>();
    let prev: ReturnType<typeof planSong> | undefined;
    let start = 0;
    for (let i = 0; i < 30; i++) {
      const p = { ...DEFAULT_PARAMS, seed: 11, mood: 'nostalgic' as const };
      const s = planSong(11, i, start, p, prev);
      expect(s.swing).toBeGreaterThanOrEqual(0);
      expect(s.swing).toBeLessThanOrEqual(0.6);
      expect(DRUM_KIT_IDS[s.kit]).toBeDefined();
      expect(s.palette.overrides['drums.kit']).toBe(s.kit);
      expect(Math.abs(s.kitTune)).toBeLessThanOrEqual(3);
      styles.add(s.drumStyle);
      kits.add(s.kit);
      prev = s;
      start += s.lengthBars;
    }
    expect(styles.size).toBeGreaterThanOrEqual(4);
    expect(kits.size).toBeGreaterThanOrEqual(4);
  });

  it('skipToNextSong advances past the current song', () => {
    const stream = new SongStream(7);
    const p = { ...DEFAULT_PARAMS, seed: 7 };
    const s0 = stream.songForBar(0, p);
    const jump = stream.skipToNextSong(8, p);
    expect(jump).toBeGreaterThan(8);
    expect(jump).toBeGreaterThanOrEqual(s0.startBar + s0.lengthBars);
  });
});
