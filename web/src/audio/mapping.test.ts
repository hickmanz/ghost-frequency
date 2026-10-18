import { describe, expect, it } from 'vitest';
import {
  TempoMap,
  beatsToSeconds,
  clampBpm,
  dbToGain,
  delaySeconds,
  faderToGain,
  invLogMap,
  logMap,
  masterFilterHz,
  brightToMasterFilter,
  noiseLevelToGain,
  parseTarget,
  rampBeatsToSeconds,
  safeCutoff,
  saturationCurve,
  drumSaturationMix,
  secondsToBeats,
  sendMultiplier,
  splitBeatToTick,
} from './mapping';
import { PRESETS } from './presets';
import { generateReverbIR } from './reverbIR';
import { encodeWav } from './wav';

describe('beat <-> seconds', () => {
  it('converts at constant tempo', () => {
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2, 9);
    expect(secondsToBeats(2, 120)).toBeCloseTo(4, 9);
    expect(beatsToSeconds(1, 60)).toBeCloseTo(1, 9);
  });

  it('clamps bpm', () => {
    expect(clampBpm(5)).toBe(30);
    expect(clampBpm(1000)).toBe(240);
    expect(clampBpm(NaN)).toBe(100);
  });

  it('ramp beats -> seconds', () => {
    expect(rampBeatsToSeconds(2, 120)).toBeCloseTo(1, 9);
    expect(rampBeatsToSeconds(0, 120)).toBe(0);
    expect(rampBeatsToSeconds(undefined, 120)).toBe(0);
  });

  it('splits beats into tick + fraction', () => {
    expect(splitBeatToTick(1, 192)).toEqual({ tick: 192, fraction: 0 });
    const s = splitBeatToTick(1 / 3, 192); // 64 ticks exactly
    expect(s.tick).toBe(64);
    expect(s.fraction).toBe(0);
    const t = splitBeatToTick(0.5 + 0.25 / 192, 192);
    expect(t.tick).toBe(96);
    expect(t.fraction).toBeCloseTo(0.25, 6);
    expect(splitBeatToTick(-3, 192).tick).toBe(0);
  });

  it('delay seconds are clamped to maxDelay', () => {
    expect(delaySeconds(120, 0.75, 3)).toBeCloseTo(0.375, 9);
    expect(delaySeconds(30, 4, 3)).toBe(3);
  });
});

describe('TempoMap', () => {
  it('constant tempo', () => {
    const m = new TempoMap(120);
    expect(m.beatToSeconds(8)).toBeCloseTo(4, 9);
    expect(m.secondsToBeat(4)).toBeCloseTo(8, 9);
  });

  it('instant change', () => {
    const m = new TempoMap(120);
    m.addChange(4, 60); // beats 0-4 @120 = 2s, then 1 s/beat
    expect(m.beatToSeconds(4)).toBeCloseTo(2, 9);
    expect(m.beatToSeconds(6)).toBeCloseTo(4, 9);
    expect(m.secondsToBeat(4)).toBeCloseTo(6, 9);
  });

  it('linear ramp: average tempo over the ramp and round trip', () => {
    const m = new TempoMap(60);
    m.addChange(4, 120, 3); // t=4s at beat 4; ramps 60->120 over 3 s => (60+120)/2*3/60 = 4.5 beats
    expect(m.beatToSeconds(4)).toBeCloseTo(4, 9);
    expect(m.secondsToBeat(7)).toBeCloseTo(8.5, 9);
    expect(m.beatToSeconds(8.5)).toBeCloseTo(7, 6);
    // after the ramp: 120 bpm => 0.5 s / beat
    expect(m.beatToSeconds(10.5)).toBeCloseTo(8, 6);
    for (const b of [0.3, 3.9, 4.1, 5, 6.2, 8.4, 9, 20]) {
      expect(m.secondsToBeat(m.beatToSeconds(b))).toBeCloseTo(b, 6);
    }
    expect(m.bpmAtBeat(2)).toBeCloseTo(60, 9);
    expect(m.bpmAtBeat(30)).toBeCloseTo(120, 9);
  });
});

describe('automation value mapping', () => {
  it('logMap / invLogMap', () => {
    expect(logMap(0, 100, 10000)).toBeCloseTo(100, 6);
    expect(logMap(1, 100, 10000)).toBeCloseTo(10000, 6);
    expect(logMap(0.5, 100, 10000)).toBeCloseTo(1000, 6);
    expect(invLogMap(1000, 100, 10000)).toBeCloseTo(0.5, 9);
    expect(logMap(-5, 100, 10000)).toBeCloseTo(100, 6); // clamped
  });

  it('master filter: log 200..20k, 1 = open, never above nyquist-safe', () => {
    expect(masterFilterHz(0)).toBeCloseTo(200, 3);
    expect(masterFilterHz(1)).toBeGreaterThanOrEqual(19800); // open (capped at 0.45 * sampleRate = 19845 @ 44.1k)
    expect(masterFilterHz(1, 48000)).toBe(20000);
    expect(masterFilterHz(0.5)).toBeCloseTo(2000, 0);
    expect(masterFilterHz(1, 32000)).toBeLessThanOrEqual(32000 * 0.45);
  });

  it('safeCutoff bounds', () => {
    expect(safeCutoff(10)).toBe(80);
    expect(safeCutoff(1e6, 44100)).toBeLessThanOrEqual(22050 * 0.9);
  });

  it('fader curve', () => {
    expect(faderToGain(0)).toBe(0);
    expect(faderToGain(1)).toBe(1);
    expect(faderToGain(0.5)).toBeCloseTo(Math.pow(0.5, 1.5), 9);
    expect(faderToGain(2)).toBe(1);
    expect(faderToGain(0.7)).toBeGreaterThan(faderToGain(0.6));
  });

  it('send multiplier: 0.5 neutral', () => {
    expect(sendMultiplier(0.5)).toBeCloseTo(1, 9);
    expect(sendMultiplier(0)).toBeCloseTo(0.4, 9);
    expect(sendMultiplier(1)).toBeCloseTo(1.6, 9);
  });

  it('noise level', () => {
    expect(noiseLevelToGain(0)).toBe(0);
    expect(noiseLevelToGain(1)).toBeCloseTo(dbToGain(-10), 9);
    expect(noiseLevelToGain(0.5)).toBeGreaterThan(noiseLevelToGain(0.2));
  });

  it('default Bright leaves the master filter open; low Bright darkens', () => {
    expect(masterFilterHz(brightToMasterFilter(0.55, 0.1))).toBeGreaterThan(15000);
    expect(masterFilterHz(brightToMasterFilter(0, 0))).toBeLessThan(4000);
  });

  it('parseTarget', () => {
    expect(parseTarget('filter.pad')).toEqual({ kind: 'filter', layer: 'pad' });
    expect(parseTarget('layer.gain.drums')).toEqual({ kind: 'layerGain', layer: 'drums' });
    expect(parseTarget('send.reverb')).toEqual({ kind: 'sendReverb' });
    expect(parseTarget('send.delay')).toEqual({ kind: 'sendDelay' });
    expect(parseTarget('texture.noise')).toEqual({ kind: 'textureNoise' });
    expect(parseTarget('master.filter')).toEqual({ kind: 'masterFilter' });
    expect(parseTarget('filter.nothing')).toEqual({ kind: 'unknown' });
  });

  it('saturation curve has unity small-signal gain and is bounded', () => {
    const c = saturationCurve(1.5, 2049);
    const mid = Math.floor(c.length / 2);
    const slope = (c[mid + 1]! - c[mid]!) / (2 / (c.length - 1));
    expect(slope).toBeCloseTo(1, 2);
    expect(Math.max(...c)).toBeLessThanOrEqual(1);
  });

  it('drum saturation is parallel: clean kits are dry, the dry path never drops far', () => {
    expect(drumSaturationMix(1)).toEqual({ wet: 0, dry: 1 });
    for (const d of [1.1, 1.6, 2.3, 3.2, 10]) {
      const m = drumSaturationMix(d);
      expect(m.wet).toBeLessThanOrEqual(0.45);
      expect(m.dry).toBeGreaterThanOrEqual(0.75);
    }
  });
});

describe('presets sanity (safety limits)', () => {
  for (const [mood, p] of Object.entries(PRESETS)) {
    it(`${mood}: cutoffs >= 80 Hz, Q < 8, feedback < 0.6, sends >= 0`, () => {
      const ranges: Array<[number, number]> = [
        [p.pad.cutoffMin, p.pad.cutoffMax], [p.arp.cutoffMin, p.arp.cutoffMax], [p.bass.cutoffMin, p.bass.cutoffMax],
        [p.lead.cutoffMin, p.lead.cutoffMax], [p.texture.noiseCutoffMin, p.texture.noiseCutoffMax],
        [p.texture.droneCutoffMin, p.texture.droneCutoffMax],
      ];
      for (const [lo, hi] of ranges) {
        expect(lo).toBeGreaterThanOrEqual(80);
        expect(hi).toBeGreaterThan(lo);
        expect(hi).toBeLessThanOrEqual(12000);
      }
      for (const q of [p.pad.q, p.arp.q, p.bass.q, p.lead.q, p.texture.droneQ]) expect(q).toBeLessThan(8);
      expect(p.fx.delayFeedback).toBeLessThan(0.6);
      expect(p.fx.delayFeedback).toBeGreaterThanOrEqual(0.3);
      for (const v of [...Object.values(p.fx.reverbSend), ...Object.values(p.fx.delaySend)]) expect(v).toBeGreaterThanOrEqual(0);
      expect(p.pad.attack).toBeGreaterThanOrEqual(1.0);
      expect(p.pad.attack).toBeLessThanOrEqual(2.5);
    });
  }
});

describe('reverb IR', () => {
  it('is deterministic, decays and is finite', () => {
    const o = { sampleRate: 8000, decay: 2, preDelay: 0.05 };
    const [l1] = generateReverbIR(o);
    const [l2] = generateReverbIR(o);
    expect(l1.length).toBe(l2.length);
    expect(Array.from(l1.slice(0, 50))).toEqual(Array.from(l2.slice(0, 50)));
    expect(l1.every(Number.isFinite)).toBe(true);
    const rms = (a: Float32Array, from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += a[i]! * a[i]!;
      return Math.sqrt(s / (to - from));
    };
    const early = rms(l1, 800, 3200); // 0.1 .. 0.4 s
    const late = rms(l1, 12000, 14400); // 1.5 .. 1.8 s
    expect(late).toBeLessThan(early * 0.25);
    expect(rms(l1, 0, 300)).toBe(0); // pre-delay silence
  });
});

describe('wav encoder', () => {
  it('writes a valid 16-bit PCM header', () => {
    const buf = encodeWav([new Float32Array([0, 0.5, -0.5, 1]), new Float32Array([0, 0, 0, 0])], 44100);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 4 * 2 * 2);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getInt16(44 + 4, true)).toBe(Math.trunc(0.5 * 0x7fff)); // frame 1, left channel
    expect(v.getInt16(44 + 12, true)).toBe(0x7fff);
  });
});
