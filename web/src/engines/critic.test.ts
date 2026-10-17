import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MOOD_IDS } from '@shared/index';
import type { GenerationParams } from '@shared/index';
import { scoreBatches, type CriticScore } from './critic';
import { DevelopEngine } from './developEngine';
import { LocalEngine } from './localEngine';

function play(kind: 'full' | 'develop', params: GenerationParams, bars: number): CriticScore {
  const engine = kind === 'full' ? new LocalEngine() : new DevelopEngine();
  engine.init(params.seed, params);
  const batches = [];
  for (let bar = 0; bar < bars; bar++) batches.push(engine.renderBars(bar, 1, params));
  return scoreBatches(batches);
}

describe('critic', () => {
  it('scores Developed as less loop-similar than Full on the same seeds', () => {
    const seeds = [1984, 7, 99];
    const rows: { seed: number; mood: string; full: CriticScore; developed: CriticScore }[] = [];
    let wins = 0;
    for (const seed of seeds) {
      for (const mood of MOOD_IDS) {
        const params: GenerationParams = { ...DEFAULT_PARAMS, seed, mood, energy: 0.5, variation: 0.55 };
        const full = play('full', params, 32);
        const developed = play('develop', params, 32);
        rows.push({ seed, mood, full, developed });
        if (developed.arpSimilarity < full.arpSimilarity) wins++;
        expect(developed.peak).toBeGreaterThan(0);
        expect(developed.leadArpCollisions).toBeLessThanOrEqual(full.leadArpCollisions + 2);
      }
    }
    // Arrangement should break the 8-bar arp copy more often than not across the grid.
    expect(wins).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBe(seeds.length * MOOD_IDS.length);
  });
});
