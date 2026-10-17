import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@shared/index';
import { AuteurEngine } from './auteurEngine';
import { LocalEngine } from './localEngine';

describe('AuteurEngine', () => {
  it('keeps notes/sections from LocalEngine but replaces automation', () => {
    const params = { ...DEFAULT_PARAMS, seed: 31415 };
    const local = new LocalEngine();
    const auteur = new AuteurEngine();
    local.init(params.seed, params);
    auteur.init(params.seed, params);
    const lb = local.renderBars(0, 2, params);
    const ab = auteur.renderBars(0, 2, params);
    const localNotes = lb.events.filter((e) => e.kind === 'note');
    const auteurNotes = ab.events.filter((e) => e.kind === 'note');
    expect(auteurNotes).toEqual(localNotes);
    expect(ab.events.some((e) => e.kind === 'automation' && String(e.target).startsWith('param.'))).toBe(true);
    expect(lb.events.some((e) => e.kind === 'automation')).toBe(true);
    expect(ab.events.filter((e) => e.kind === 'automation' && !String(e.target).startsWith('param.')).length).toBeGreaterThan(
      0,
    );
  });

  it('is deterministic', () => {
    const params = { ...DEFAULT_PARAMS, seed: 2718 };
    const a = new AuteurEngine();
    const b = new AuteurEngine();
    a.init(params.seed, params);
    b.init(params.seed, params);
    expect(a.renderBars(4, 2, params)).toEqual(b.renderBars(4, 2, params));
  });
});
