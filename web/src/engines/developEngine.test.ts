import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@shared/index';
import type { EventBatch, GenerationParams, NoteEvent } from '@shared/index';
import { DevelopEngine } from './developEngine';
import { LocalEngine } from './localEngine';

function render(engine: { init(seed: number, p: GenerationParams): void; renderBars(from: number, n: number, p: GenerationParams): EventBatch }, params: GenerationParams, bars: number): EventBatch[] {
  engine.init(params.seed, params);
  const out: EventBatch[] = [];
  for (let bar = 0; bar < bars; bar++) out.push(engine.renderBars(bar, 1, params));
  return out;
}

function notes(batches: EventBatch[]): NoteEvent[] {
  return batches.flatMap((b) => b.events.filter((e): e is NoteEvent => e.kind === 'note'));
}

function fingerprint(batches: EventBatch[]): string {
  return notes(batches)
    .map((n) => `${n.layer}:${n.beat.toFixed(3)}:${n.midi}:${n.durBeats.toFixed(3)}`)
    .join(';');
}

describe('DevelopEngine', () => {
  const params: GenerationParams = { ...DEFAULT_PARAMS, seed: 1984, mood: 'nostalgic', energy: 0.55, variation: 0.6 };

  it('reproduces a piece from the same seed', () => {
    const a = fingerprint(render(new DevelopEngine(), params, 24));
    const b = fingerprint(render(new DevelopEngine(), params, 24));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it('is a different piece from Full on the same seed', () => {
    const full = fingerprint(render(new LocalEngine(), params, 32));
    const developed = fingerprint(render(new DevelopEngine(), params, 32));
    expect(developed).not.toBe(full);
  });

  it('keeps Full free of bell notes and duck events', () => {
    const batches = render(new LocalEngine(), params, 16);
    const ns = notes(batches);
    expect(ns.some((n) => n.layer === 'bell')).toBe(false);
    const ducks = batches.flatMap((b) => b.events).filter((e) => e.kind === 'automation' && (e.target === 'duck.pad' || e.target === 'duck.texture'));
    expect(ducks).toHaveLength(0);
  });

  it('adds bell notes and kick ducks once the arrangement is underway', () => {
    const batches = render(new DevelopEngine(), { ...params, energy: 0.45 }, 64);
    const ns = notes(batches);
    expect(ns.some((n) => n.layer === 'bell')).toBe(true);
    const events = batches.flatMap((b) => b.events);
    expect(events.some((e) => e.kind === 'automation' && e.target === 'duck.pad')).toBe(true);
    for (const n of ns.filter((x) => x.layer === 'bell')) {
      expect(n.midi).toBeGreaterThanOrEqual(72);
      expect(n.midi).toBeLessThanOrEqual(88);
      expect(n.vel).toBeLessThan(0.5);
    }
  });
});
