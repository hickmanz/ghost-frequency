import { describe, expect, it } from 'vitest';
import { buildTestBatches } from './devHarness';

describe('dev harness batches', () => {
  it('are contiguous, in range and well-formed', () => {
    const batches = buildTestBatches(8, 92);
    expect(batches.length).toBe(2);
    expect(batches[0]!.startBeat).toBe(0);
    expect(batches[0]!.endBeat).toBe(batches[1]!.startBeat);
    expect(batches[1]!.endBeat).toBe(32);
    for (const b of batches) {
      for (const e of b.events) {
        expect(e.beat).toBeGreaterThanOrEqual(b.startBeat);
        expect(e.beat).toBeLessThan(b.endBeat);
        if (e.kind === 'note') {
          expect(e.midi).toBeGreaterThanOrEqual(0);
          expect(e.midi).toBeLessThanOrEqual(127);
          expect(e.vel).toBeGreaterThan(0);
          expect(e.vel).toBeLessThanOrEqual(1);
          expect(e.durBeats).toBeGreaterThan(0);
        }
      }
    }
  });
});
