import { describe, expect, it } from 'vitest';
import { ComposerLiveState } from './composerLive';

describe('ComposerLiveState', () => {
  it('tracks params and bumps version', () => {
    const s = new ComposerLiveState();
    expect(s.getVersion()).toBe(0);
    s.setParam('pad.attack', 2);
    expect(s.getParam('pad.attack')).toBe(2);
    expect(s.getVersion()).toBe(1);
    s.clear();
    expect(s.getParam('pad.attack')).toBeUndefined();
    expect(s.getVersion()).toBe(2);
  });
});
