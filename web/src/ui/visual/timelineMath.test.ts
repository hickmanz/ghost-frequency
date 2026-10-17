import { describe, expect, it } from 'vitest';
import {
  LANE_ORDER,
  barLabelStride,
  beatToX,
  drumRow,
  energyAtBeat,
  findSectionIndex,
  gainAtBeat,
  gainTargetLayer,
  insertBreakpoint,
  keyShortLabel,
  laneIndex,
  notePitchFrac,
  pastBarsFor,
  pxPerBeatFor,
  sampleBarValues,
  sectionColor,
  visibleBeatRange,
  xToBeat,
  type SectionLike,
} from './timelineMath';

const key = { tonic: 9, scale: 'aeolian' } as const;
const secs: SectionLike[] = [
  { index: 0, name: 'Intro', startBeat: 0, endBeat: 32, energy: 0.2, key },
  { index: 1, name: 'Build', startBeat: 32, endBeat: 64, energy: 0.6, key },
  { index: 2, name: 'Peak', startBeat: 64, endBeat: Infinity, energy: 1, key },
];

describe('beat <-> x mapping', () => {
  it('playhead maps to nowBeat and round-trips', () => {
    const ppb = pxPerBeatFor(1000, 48);
    expect(beatToX(100, 100, 750, ppb)).toBe(750);
    expect(xToBeat(beatToX(123.5, 100, 750, ppb), 100, 750, ppb)).toBeCloseTo(123.5, 9);
  });
  it('48 bars fit between left edge and playhead', () => {
    const w = 960;
    const ppb = pxPerBeatFor(w, 48);
    const now = 500;
    expect(beatToX(now - 48 * 4, now, w * 0.75, ppb)).toBeCloseTo(0, 6);
  });
  it('visible range is clamped at 0', () => {
    const ppb = pxPerBeatFor(1000);
    const r = visibleBeatRange(10, 1000, 750, ppb);
    expect(r.from).toBe(0);
    expect(r.to).toBeGreaterThan(10);
    const r2 = visibleBeatRange(1000, 1000, 750, ppb);
    expect(r2.from).toBeCloseTo(1000 - 192, 6);
    expect(r2.to).toBeCloseTo(1000 + 64, 6);
  });
  it('narrow canvases show fewer bars', () => {
    expect(pastBarsFor(1200)).toBe(48);
    expect(pastBarsFor(500)).toBeLessThan(48);
    expect(pastBarsFor(300)).toBeLessThan(pastBarsFor(500));
  });
  it('label stride doubles until labels fit', () => {
    expect(barLabelStride(40, 30)).toBe(1);
    expect(barLabelStride(14, 30)).toBe(4);
    expect(barLabelStride(0.1, 30)).toBe(64);
  });
});

describe('lane assignment', () => {
  it('has a unique lane per layer', () => {
    const idx = LANE_ORDER.map(laneIndex);
    expect(new Set(idx).size).toBe(LANE_ORDER.length);
    expect(Math.max(...idx)).toBe(LANE_ORDER.length - 1);
  });
  it('pitch fraction is clamped and monotonic', () => {
    expect(notePitchFrac('bass', 0)).toBe(0);
    expect(notePitchFrac('bass', 127)).toBe(1);
    expect(notePitchFrac('lead', 60)).toBeLessThan(notePitchFrac('lead', 90));
  });
  it('drum rows', () => {
    expect(drumRow(36)).toBe(3);
    expect(drumRow(38)).toBe(2);
    expect(drumRow(39)).toBe(2);
    expect(drumRow(42)).toBe(1);
    expect(drumRow(46)).toBe(1);
    expect(drumRow(49)).toBe(0);
  });
  it('gain target parsing', () => {
    expect(gainTargetLayer('layer.gain.bass')).toBe('bass');
    expect(gainTargetLayer('layer.gain.nope')).toBeNull();
    expect(gainTargetLayer('filter.pad')).toBeNull();
  });
});

describe('gain breakpoints', () => {
  it('keeps order, drops the oldest when full, answers gainAtBeat', () => {
    const beats = new Float64Array(3);
    const vals = new Float32Array(3);
    const ramps = new Float32Array(3);
    let n = 0;
    n = insertBreakpoint(beats, vals, ramps, n, 16, 0, 0);
    n = insertBreakpoint(beats, vals, ramps, n, 8, 1, 0); // out of order insert
    expect(Array.from(beats.slice(0, n))).toEqual([8, 16]);
    expect(gainAtBeat(beats, vals, ramps, n, 4)).toBe(1); // before first -> 1
    expect(gainAtBeat(beats, vals, ramps, n, 10)).toBe(1);
    expect(gainAtBeat(beats, vals, ramps, n, 17)).toBe(0);
    n = insertBreakpoint(beats, vals, ramps, n, 24, 1, 4);
    n = insertBreakpoint(beats, vals, ramps, n, 40, 0.5, 0);
    expect(n).toBe(3);
    expect(Array.from(beats)).toEqual([16, 24, 40]);
    expect(gainAtBeat(beats, vals, ramps, n, 25)).toBe(0); // ramp not yet half way
    expect(gainAtBeat(beats, vals, ramps, n, 26)).toBe(1);
  });
});

describe('sections', () => {
  it('named sections get distinct colours; unknown names are stable', () => {
    const hues = ['Intro', 'Drift', 'Build', 'Peak', 'Breakdown'].map((n) => sectionColor(n).h);
    expect(new Set(hues).size).toBe(5);
    expect(sectionColor('Weird').h).toBe(sectionColor('weird ').h);
    expect(sectionColor('Weird').h).toBeGreaterThanOrEqual(0);
    expect(sectionColor('Weird').h).toBeLessThan(360);
  });
  it('key labels', () => {
    expect(keyShortLabel(key)).toBe('A minor');
    expect(keyShortLabel({ tonic: 2, scale: 'dorian' })).toBe('D dorian');
    expect(keyShortLabel({ tonic: 13, scale: 'ionian' })).toBe('C# major');
  });
  it('findSectionIndex', () => {
    expect(findSectionIndex(secs, -1)).toBe(-1);
    expect(findSectionIndex(secs, 0)).toBe(0);
    expect(findSectionIndex(secs, 31.9)).toBe(0);
    expect(findSectionIndex(secs, 32)).toBe(1);
    expect(findSectionIndex(secs, 1e6)).toBe(2);
    expect(findSectionIndex([], 3)).toBe(-1);
  });
  it('energyAtBeat holds within a section and ramps across boundaries', () => {
    expect(energyAtBeat([], 10, 4, 0.4)).toBe(0.4);
    expect(energyAtBeat(secs, 5)).toBe(0.2);
    expect(energyAtBeat(secs, 40)).toBe(0.6);
    expect(energyAtBeat(secs, 32)).toBeCloseTo(0.2, 9);
    const mid = energyAtBeat(secs, 34);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.6);
    expect(energyAtBeat(secs, 36)).toBeCloseTo(0.6, 9);
  });
  it('sampleBarValues interpolates between bar centres and clamps', () => {
    const v = new Float32Array([0, 1, 0.5]);
    expect(sampleBarValues(v, 3, 10, 0)).toBe(0); // before
    expect(sampleBarValues(v, 3, 10, 10 * 4 + 2)).toBeCloseTo(0, 9); // centre of bar 10
    expect(sampleBarValues(v, 3, 10, 11 * 4 + 2)).toBeCloseTo(1, 9);
    expect(sampleBarValues(v, 3, 10, 11 * 4)).toBeCloseTo(0.5, 9);
    expect(sampleBarValues(v, 3, 10, 1e6)).toBe(0.5);
    expect(sampleBarValues(v, 0, 10, 50)).toBe(0);
  });
});
