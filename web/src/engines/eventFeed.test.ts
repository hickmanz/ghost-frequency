import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type EventBatch, type MusicEvent } from '@shared/index';
import { EventFeed } from './eventFeed';

const key = { tonic: 9, scale: 'aeolian' as const };

function batch(bar: number, events: MusicEvent[], tempo = 90): EventBatch {
  return { version: SCHEMA_VERSION, startBeat: bar * 4, endBeat: bar * 4 + 4, tempo, timeSig: [4, 4], events };
}
const note = (beat: number): MusicEvent => ({ kind: 'note', layer: 'arp', beat, durBeats: 0.5, midi: 60, vel: 0.5 });
const section = (beat: number, index: number, name: string): MusicEvent => ({
  kind: 'section', beat, name, sectionIndex: index, key, energy: 0.5,
});

describe('EventFeed', () => {
  it('returns events in the requested beat window only', () => {
    const f = new EventFeed();
    f.add(batch(0, [note(0), note(1.5), note(3)]));
    f.add(batch(1, [note(4), note(6)]));
    const got: number[] = [];
    f.forEachEvent(1, 5, (e) => got.push(e.beat));
    expect(got.sort((a, b) => a - b)).toEqual([1.5, 3, 4]);
  });

  it('builds section spans, closing the previous one and ignoring repeated chord-change events', () => {
    const f = new EventFeed();
    f.add(batch(0, [section(0, 0, 'Intro'), section(2, 0, 'Intro')]));
    f.add(batch(8, [section(32, 1, 'Drift')]));
    const s = f.getSections();
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ index: 0, startBeat: 0, endBeat: 32 });
    expect(s[1]).toMatchObject({ index: 1, name: 'Drift', startBeat: 32, endBeat: Infinity });
  });

  it('reports tempo per bar and clears', () => {
    const f = new EventFeed();
    f.add(batch(0, [], 80));
    f.add(batch(1, [], 96));
    expect(f.getBpmAt(2)).toBe(80);
    expect(f.getBpmAt(5)).toBe(96);
    f.clear();
    expect(f.getBpmAt(0)).toBe(0);
    expect(f.getSections()).toHaveLength(0);
  });

  it('prunes old bars to bound memory', () => {
    const f = new EventFeed(8);
    for (let b = 0; b < 40; b++) f.add(batch(b, [note(b * 4)]));
    let count = 0;
    f.forEachEvent(0, 200, () => count++);
    expect(count).toBeLessThanOrEqual(10);
  });
});
