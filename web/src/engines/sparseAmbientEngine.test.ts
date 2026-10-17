import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@shared/index';
import { LocalEngine } from './localEngine';
import { SparseAmbientEngine } from './sparseAmbientEngine';

describe('SparseAmbientEngine', () => {
  it('is deterministic for the same seed', () => {
    const params = { ...DEFAULT_PARAMS, seed: 777 };
    const a = new SparseAmbientEngine();
    const b = new SparseAmbientEngine();
    a.init(params.seed, params);
    b.init(params.seed, params);
    expect(a.renderBars(0, 2, params)).toEqual(b.renderBars(0, 2, params));
  });

  it('differs from full engine output for the same seed', () => {
    const params = { ...DEFAULT_PARAMS, seed: 888 };
    const sparse = new SparseAmbientEngine();
    const full = new LocalEngine();
    sparse.init(params.seed, params);
    full.init(params.seed, params);
    const sa = sparse.renderBars(0, 1, params);
    const fb = full.renderBars(0, 1, params);
    expect(sa.events.length).not.toBe(fb.events.length);
  });
});
