import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@shared/index';
import { LocalEngine } from './localEngine';

describe('LocalEngine rewind', () => {
  it('re-render after rewind matches fresh render for the same bars', () => {
    const params = { ...DEFAULT_PARAMS, seed: 808 };
    const a = new LocalEngine();
    a.init(params.seed, params);
    a.renderBars(0, 32, params);
    a.rewind(16);
    const part = a.renderBars(16, 8, params).events.filter((e) => e.kind === 'note');

    const b = new LocalEngine();
    b.init(params.seed, params);
    b.renderBars(0, 16, params);
    const fresh = b.renderBars(16, 8, params).events.filter((e) => e.kind === 'note');

    const key = (events: typeof part) =>
      JSON.stringify(events, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
    expect(key(part)).toBe(key(fresh));
  });
});
