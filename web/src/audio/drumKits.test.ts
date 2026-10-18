import { afterEach, describe, expect, it } from 'vitest';
import { DRUM_KIT_IDS } from '@shared/index';
import { DRUM_KITS, drumPresetFor, getPreset, setTuningOverrides, splitDrumKit } from './presets';

describe('drum kits', () => {
  afterEach(() => setTuningOverrides('nostalgic', {}));

  it('every kit id has a definition', () => {
    for (const id of DRUM_KIT_IDS) expect(DRUM_KITS[id]).toBeDefined();
  });

  it('a kit reshapes the mood drums; null keeps them', () => {
    const base = getPreset('nostalgic').drums;
    expect(drumPresetFor('nostalgic', null)).toEqual(base);
    const k808 = drumPresetFor('nostalgic', 'tr808');
    expect(k808.kickDecay).toBe(DRUM_KITS.tr808.shape.kickDecay);
    expect(k808.clapDb).toBe(base.clapDb + DRUM_KITS.tr808.db.clapDb!);
    expect(drumPresetFor('nostalgic', 'tape').ceilingHz).toBeLessThan(base.ceilingHz);
  });

  it('Sound Lab drum overrides win over the kit', () => {
    setTuningOverrides('nostalgic', { 'drums.kickDecay': 0.2, 'drums.clapDb': -20 });
    const p = drumPresetFor('nostalgic', 'tr808');
    expect(p.kickDecay).toBe(0.2);
    expect(p.clapDb).toBe(-20);
  });

  it('splitDrumKit separates the kit keys from the palette', () => {
    const { kit, tune, rest } = splitDrumKit({ 'drums.kit': 2, 'drums.tune': -1, 'pad.cutoffMax': 4000 });
    expect(kit).toBe(2);
    expect(tune).toBe(-1);
    expect(rest).toEqual({ 'pad.cutoffMax': 4000 });
    expect(splitDrumKit({}).kit).toBeUndefined();
  });
});
