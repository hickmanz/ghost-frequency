import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISUAL_MODE,
  VISUAL_MODES,
  isVisualMode,
  nextVisualMode,
  parseVisualMode,
  serializeVisualMode,
} from './visualMode';

describe('parseVisualMode / serializeVisualMode', () => {
  it('round-trips every mode', () => {
    for (const m of VISUAL_MODES) expect(parseVisualMode(serializeVisualMode(m))).toBe(m);
  });
  it('falls back to default for invalid input', () => {
    expect(DEFAULT_VISUAL_MODE).toBe('landscape');
    for (const bad of [null, undefined, '', 'Classic', 'LANDSCAPE', 'nope', 3, {}, [], true]) {
      expect(parseVisualMode(bad)).toBe('landscape');
    }
  });
  it('isVisualMode guards', () => {
    expect(isVisualMode('timeline')).toBe(true);
    expect(isVisualMode('toString')).toBe(false);
    expect(isVisualMode(undefined)).toBe(false);
  });
});

describe('nextVisualMode', () => {
  it('cycles in order and wraps', () => {
    expect(nextVisualMode('classic')).toBe('landscape');
    expect(nextVisualMode('landscape')).toBe('spectrogram');
    expect(nextVisualMode('spectrogram')).toBe('timeline');
    expect(nextVisualMode('timeline')).toBe('classic');
  });
  it('supports backwards steps', () => {
    expect(nextVisualMode('classic', -1)).toBe('timeline');
    expect(nextVisualMode('landscape', -1)).toBe('classic');
  });
});
