import { describe, expect, it } from 'vitest';
import { MOOD_IDS } from '@shared/index';
import { sanitizeOverrides } from '../audio/presets';
import { samplePalette } from './palettes';
import { stream } from './rng';

describe('palettes', () => {
  it('palette overrides use valid preset keys', () => {
    for (const mood of MOOD_IDS) {
      const { overrides } = samplePalette(mood, stream(42, 'palette', 0), 0.8);
      const clean = sanitizeOverrides(overrides);
      for (const key of Object.keys(overrides)) {
        if (key.startsWith('drums.')) continue;
        expect(clean[key], `${mood} ${key}`).toBeDefined();
      }
      expect(Object.keys(clean).length).toBeGreaterThan(6);
    }
  });
});
