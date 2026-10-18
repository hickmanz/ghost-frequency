import { describe, expect, it } from 'vitest';
import { stream } from '../../composition/rng';
import { sampleContrastUnit, sampleSongHomes } from './songHomes';

describe('songHomes', () => {
  it('high contrast produces more edge-biased samples', () => {
    let edgesLow = 0;
    let edgesHigh = 0;
    for (let i = 0; i < 400; i++) {
      const vLo = sampleContrastUnit(stream(1, 't', i), 0.15);
      const vHi = sampleContrastUnit(stream(2, 't', i), 0.95);
      if (vLo < 0.28 || vLo > 0.72) edgesLow++;
      if (vHi < 0.28 || vHi > 0.72) edgesHigh++;
    }
    expect(edgesHigh).toBeGreaterThan(edgesLow);
  });

  it('song homes differ by song index', () => {
    const a = sampleSongHomes(stream(99, 'director-home', 0), 0.7);
    const b = sampleSongHomes(stream(99, 'director-home', 1), 0.7);
    expect(a.tone.bright).not.toBe(b.tone.bright);
    expect(a.vibe.brightness).not.toBe(b.vibe.brightness);
  });
});
