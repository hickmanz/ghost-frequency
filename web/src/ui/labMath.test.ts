import { describe, expect, it } from 'vitest';
import { TUNING_SCHEMA } from '../tuning/params';
import type { TuningParam } from '../tuning/schema';
import {
  buildFilterSpecs,
  buildSections,
  buildSpectrumColumns,
  envelopeInputFromValues,
  envelopeLevel,
  envelopeShape,
  findEnvelopeParams,
  findOption,
  findSpreadParam,
  findUnisonParam,
  findWaveParams,
  focusInfo,
  formatHzShort,
  freqToNorm,
  freqToX,
  highpassDb,
  levelToMeter,
  lowpassDb,
  normToFreq,
  sampleSpectrum,
  sampleWave,
  sectionOf,
  unisonRatios,
  visualDetune,
  waveGlyphPoints,
  waveValue,
  xToFreq,
} from './labMath';

const sl = (key: string, label = key, extra: Partial<TuningParam> = {}): TuningParam => ({
  key,
  label,
  hint: '',
  min: 0,
  max: 1,
  step: 0.01,
  ...extra,
});

const wave = sl('arp.wave', 'Wave', {
  kind: 'choice',
  visual: 'wave',
  min: 0,
  max: 3,
  step: 1,
  options: [
    { value: 0, label: 'Saw', wave: 'sawtooth' },
    { value: 1, label: 'Fat saw', wave: 'sawtooth', fat: true },
    { value: 2, label: 'Square', wave: 'square' },
    { value: 3, label: 'Sine', wave: 'sine' },
  ],
});

const ARP: TuningParam[] = [
  wave,
  sl('arp.cutoffMax', 'Open'),
  sl('arp.cutoffMin', 'Closed'),
  sl('arp.filterOctaves'),
  sl('arp.filterDecay'),
  sl('arp.attack'),
  sl('arp.decay'),
  sl('arp.release'),
  sl('arp.spread'),
  sl('arp.chorusWet'),
  sl('arp.q'),
  sl('arp.panDepth'),
  sl('arp.levelDb'),
];

describe('log frequency axis', () => {
  it('maps the ends and decades', () => {
    expect(freqToNorm(20)).toBe(0);
    expect(freqToNorm(20000)).toBe(1);
    expect(freqToNorm(10)).toBe(0);
    expect(freqToNorm(40000)).toBe(1);
    expect(freqToNorm(632.4555)).toBeCloseTo(0.5, 3); // geometric midpoint of 20..20000
    expect(freqToX(2000, 300)).toBeCloseTo(200, 6); // 2 decades of 3
  });
  it('round-trips and is monotonic', () => {
    let prev = -1;
    for (const f of [20, 50, 100, 440, 1000, 5000, 12000, 20000]) {
      const x = freqToX(f, 500);
      expect(x).toBeGreaterThan(prev);
      prev = x;
      expect(xToFreq(x, 500)).toBeCloseTo(f, 4);
    }
    expect(normToFreq(2)).toBeCloseTo(20000, 6);
  });
  it('formats short labels', () => {
    expect(formatHzShort(100)).toBe('100');
    expect(formatHzShort(1000)).toBe('1k');
    expect(formatHzShort(10000)).toBe('10k');
    expect(formatHzShort(2500)).toBe('2.5k');
  });
});

describe('spectrum sampling', () => {
  it('covers increasing, contiguous bin ranges', () => {
    const lo = new Float32Array(100);
    const hi = new Float32Array(100);
    buildSpectrumColumns(100, 1024, 44100, lo, hi);
    for (let i = 1; i < 100; i++) expect(lo[i]!).toBeCloseTo(hi[i - 1]!, 3);
    expect(lo[0]!).toBeCloseTo(20 / (22050 / 1024), 3);
    expect(hi[99]!).toBeCloseTo(20000 / (22050 / 1024), 2);
  });
  it('takes the max over wide ranges and interpolates narrow ones', () => {
    const spec = Float32Array.from([-100, -50, -80, -20, -90]);
    expect(sampleSpectrum(spec, 0.5, 4.5)).toBe(-20);
    expect(sampleSpectrum(spec, 1.4, 1.6)).toBeCloseTo(-50 * 0.5 + -80 * 0.5, 6);
    expect(sampleSpectrum(new Float32Array(0), 0, 1)).toBe(-Infinity);
  });
});

describe('wave sampling', () => {
  it('has the canonical shapes', () => {
    expect(waveValue('sine', 0)).toBeCloseTo(0, 9);
    expect(waveValue('sine', 0.25)).toBeCloseTo(1, 9);
    expect(waveValue('triangle', 0.25)).toBeCloseTo(1, 9);
    expect(waveValue('triangle', 0.75)).toBeCloseTo(-1, 9);
    expect(waveValue('sawtooth', 0)).toBe(-1);
    expect(waveValue('sawtooth', 0.5)).toBeCloseTo(0, 9);
    expect(waveValue('square', 0.1)).toBe(1);
    expect(waveValue('square', 0.6)).toBe(-1);
    expect(waveValue('pulse', 0.2)).toBe(1);
    expect(waveValue('pulse', 0.3)).toBe(-1);
    expect(waveValue('sine', 1.25)).toBeCloseTo(1, 9); // periodic
    expect(waveValue('sine', -0.75)).toBeCloseTo(1, 9);
  });
  it('stays within -1..1', () => {
    const out = new Float32Array(200);
    for (const w of ['sine', 'triangle', 'sawtooth', 'square', 'pulse'] as const) {
      sampleWave(w, 3, 1, out);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it('detuned copies line up at the start and drift apart later', () => {
    const a = new Float32Array(100);
    const b = new Float32Array(100);
    sampleWave('sine', 3, 1, a);
    sampleWave('sine', 3, 1.035, b);
    expect(a[0]).toBeCloseTo(b[0]!, 6);
    expect(Math.abs(a[99]! - b[99]!)).toBeGreaterThan(0.05);
  });
  it('makes SVG glyph points', () => {
    const pts = waveGlyphPoints('square', 30, 14).split(' ');
    expect(pts.length).toBe(41);
    expect(pts[0]).toMatch(/^0\.0,/);
  });
});

describe('envelope', () => {
  const adsr = envelopeShape({ attack: 0.2, decay: 0.4, sustain: 0.5, release: 0.6 });
  it('reaches 1 at the end of attack, sustain after decay and 0 at the end', () => {
    expect(envelopeLevel(adsr, 0)).toBe(0);
    expect(envelopeLevel(adsr, 0.1)).toBeCloseTo(0.5, 6);
    expect(envelopeLevel(adsr, adsr.tAttack - 1e-6)).toBeCloseTo(1, 3);
    expect(envelopeLevel(adsr, adsr.tDecay + 1e-6)).toBeCloseTo(0.5, 6);
    expect(envelopeLevel(adsr, (adsr.tDecay + adsr.tOff) / 2)).toBeCloseTo(0.5, 6);
    expect(envelopeLevel(adsr, adsr.total)).toBe(0);
    expect(adsr.tOff).toBeGreaterThan(adsr.tDecay);
  });
  it('decays and releases monotonically', () => {
    let prev = 1;
    for (let t = adsr.tAttack; t <= adsr.tDecay; t += 0.01) {
      const v = envelopeLevel(adsr, t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    prev = 1;
    for (let t = adsr.tOff; t <= adsr.total; t += 0.01) {
      const v = envelopeLevel(adsr, t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
  it('draws a pluck when sustain is 0', () => {
    const pl = envelopeShape({ attack: 0.01, decay: 0.5, sustain: 0, release: 0.3 });
    expect(pl.sustained).toBe(false);
    expect(envelopeLevel(pl, pl.tAttack - 1e-6)).toBeCloseTo(1, 1);
    expect(pl.levelOff).toBeGreaterThan(0);
    expect(pl.levelOff).toBeLessThan(1);
    expect(envelopeLevel(pl, pl.total + 1)).toBe(0);
  });
  it('treats a release-less one-shot as decay only', () => {
    const d = envelopeShape({ attack: 0.002, decay: 0.3, sustain: 0, release: 0 });
    expect(d.tOff).toBeCloseTo(d.tDecay, 9);
    expect(d.total).toBeCloseTo(d.tDecay, 3);
    expect(envelopeLevel(d, d.tDecay - 0.01)).toBeGreaterThan(0);
    expect(envelopeInputFromValues(findEnvelopeParams([sl('drums.kickDecay')]), () => 0.3)).toEqual({ attack: 0.002, decay: 0.3, sustain: 0, release: 0 });
  });
  it('survives zero lengths', () => {
    const z = envelopeShape({ attack: 0, decay: 0, sustain: 0, release: 0 });
    expect(Number.isFinite(z.total)).toBe(true);
    expect(Number.isFinite(envelopeLevel(z, 0.0005))).toBe(true);
  });
  it('finds envelope params and fills the gaps', () => {
    const spec = findEnvelopeParams(ARP);
    expect(spec.keys).toEqual({ attack: 'arp.attack', decay: 'arp.decay', release: 'arp.release' }); // filterDecay skipped
    const inp = envelopeInputFromValues(spec, (k) => (k === 'arp.attack' ? 0.05 : k === 'arp.decay' ? 0.3 : 0.7));
    expect(inp).toEqual({ attack: 0.05, decay: 0.3, sustain: 0, release: 0.7 });
    const padSpec = findEnvelopeParams([sl('pad.attack'), sl('pad.release')]);
    expect(envelopeInputFromValues(padSpec, () => 1).sustain).toBe(1);
    expect(findEnvelopeParams([sl('bass.ampDecay'), sl('bass.glide')]).keys).toEqual({ decay: 'bass.ampDecay' });
    expect(findEnvelopeParams([sl('x.kickDecay'), sl('x.decay')]).keys.decay).toBe('x.decay');
  });
});

describe('filter response', () => {
  it('is flat in the pass band and falls ~24 dB/oct above cutoff', () => {
    expect(lowpassDb(50, 2000, 0.7)).toBeCloseTo(0, 1);
    const a = lowpassDb(8000, 1000, 0.7);
    const b = lowpassDb(16000, 1000, 0.7);
    expect(a - b).toBeGreaterThan(20);
    expect(a - b).toBeLessThan(26);
  });
  it('is monotonically non-increasing without resonance', () => {
    let prev = Infinity;
    for (let f = 20; f <= 20000; f *= 1.05) {
      const v = lowpassDb(f, 1500, 0.5);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
  it('gets a resonance bump near the cutoff that grows with q', () => {
    const low = lowpassDb(1000, 1000, 0.7);
    const mid = lowpassDb(1000, 1000, 2);
    const high = lowpassDb(1000, 1000, 6);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    let peakF = 0;
    let peak = -Infinity;
    for (let f = 100; f <= 10000; f *= 1.02) {
      const v = lowpassDb(f, 1000, 6);
      if (v > peak) {
        peak = v;
        peakF = f;
      }
    }
    expect(peak).toBeGreaterThan(6);
    expect(peakF).toBeGreaterThan(800);
    expect(peakF).toBeLessThan(1100);
  });
  it('high-pass mirrors the low-pass', () => {
    expect(highpassDb(10000, 1000, 0.7)).toBeCloseTo(0, 1);
    expect(highpassDb(100, 1000, 0.7)).toBeLessThan(-30);
    expect(highpassDb(2000, 1000, 2)).toBeCloseTo(lowpassDb(500, 1000, 2), 6);
  });
  it('builds filter specs from key names', () => {
    const values: Record<string, number> = {
      'arp.cutoffMax': 4000,
      'arp.cutoffMin': 300,
      'arp.filterOctaves': 2,
      'arp.q': 3,
    };
    const specs = buildFilterSpecs(ARP, (k) => values[k] ?? 0, 'Arpeggio');
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ cutMin: 300, cutMax: 4000, q: 3, octaves: 2, type: 'lp' });
    expect(specs[0]!.keys).toMatchObject({ min: 'arp.cutoffMin', max: 'arp.cutoffMax', oct: 'arp.filterOctaves', q: 'arp.q' });
  });
  it('supports prefixed pairs and single cutoffs, and swaps inverted ranges', () => {
    const params = [
      sl('texture.noiseCutoffMax'),
      sl('texture.noiseCutoffMin'),
      sl('texture.droneCutoffMax'),
      sl('texture.droneCutoffMin'),
      sl('drums.hatHpHz', 'Hat'),
      sl('drums.ceilingHz', 'Ceil'),
    ];
    const v: Record<string, number> = {
      'texture.noiseCutoffMax': 200,
      'texture.noiseCutoffMin': 900, // inverted
      'texture.droneCutoffMax': 3000,
      'texture.droneCutoffMin': 300,
      'drums.hatHpHz': 7000,
      'drums.ceilingHz': 9000,
    };
    const specs = buildFilterSpecs(params, (k) => v[k]!);
    expect(specs.map((s) => s.label)).toEqual(['Noise', 'Drone', 'Hat', 'Ceil']);
    expect(specs[0]).toMatchObject({ cutMin: 200, cutMax: 900 });
    expect(specs[2]).toMatchObject({ type: 'hp', cutMin: 7000, cutMax: 7000 });
    expect(specs[3]).toMatchObject({ type: 'lp', cutMin: 9000 });
  });
});

describe('unison', () => {
  it('spreads copies evenly around 1', () => {
    expect(unisonRatios(1, 0.05)).toEqual([1]);
    expect(unisonRatios(3, 0.05)).toEqual([0.95, 1, 1.05]);
    const five = unisonRatios(5, 0.04);
    expect(five).toHaveLength(5);
    expect(five[0]).toBeCloseTo(0.96, 9);
    expect(five[4]).toBeCloseTo(1.04, 9);
    expect(unisonRatios(99, 0.04)).toHaveLength(7); // capped
    expect(unisonRatios(Number.NaN, 0.04)).toEqual([1]);
  });
  it('scales the visual detune with the spread', () => {
    expect(visualDetune(undefined)).toBeCloseTo(0.035);
    expect(visualDetune(0)).toBeLessThan(visualDetune(60));
    expect(visualDetune(1000)).toBeCloseTo(0.07);
  });
  it('pairs unison sliders with their wave by trailing digit', () => {
    const params = [sl('lead.wave0'), sl('lead.unison0'), sl('lead.wave1'), sl('lead.spread')];
    expect(findUnisonParam(params, 'lead.wave0')?.key).toBe('lead.unison0');
    expect(findUnisonParam(params, 'lead.wave1')).toBeUndefined();
    expect(findUnisonParam([sl('arp.wave'), sl('arp.unison')], 'arp.wave')?.key).toBe('arp.unison');
    expect(findSpreadParam(params)?.key).toBe('lead.spread');
  });
});

describe('real schema (generic invariants)', () => {
  it('every param lands in a section and every visual helper copes', () => {
    for (const g of TUNING_SCHEMA) {
      const secs = buildSections(g.params);
      expect(secs.flatMap((s) => s.params).length).toBe(g.params.length);
      const get = (k: string) => g.params.find((p) => p.key === k)?.min ?? 1;
      const specs = buildFilterSpecs(g.params, get, g.label);
      for (const s of specs) {
        expect(s.cutMin).toBeLessThanOrEqual(s.cutMax);
        expect(Number.isFinite(lowpassDb(1000, s.cutMax, s.q))).toBe(true);
      }
      const env = findEnvelopeParams(g.params);
      if (env.count > 0) {
        const shape = envelopeShape(envelopeInputFromValues(env, get));
        expect(Number.isFinite(shape.total)).toBe(true);
      }
      for (const w of findWaveParams(g.params)) {
        expect(w.options!.length).toBeGreaterThan(1);
        expect(findOption(w, w.min)?.wave).toBeDefined();
      }
      for (const p of g.params) focusInfo(g.params, p.key, specs);
    }
  });
});

describe('waves in a group', () => {
  it('finds choice params and nearest options', () => {
    expect(findWaveParams(ARP).map((p) => p.key)).toEqual(['arp.wave']);
    expect(findOption(wave, 2)?.wave).toBe('square');
    expect(findOption(wave, 1.2)?.fat).toBe(true);
    expect(findOption(sl('x'), 1)).toBeUndefined();
  });
});

describe('focus mapping', () => {
  const specs = buildFilterSpecs(ARP, (k) => (k.endsWith('Max') ? 4000 : 300));
  it('maps keys to the visual they drive', () => {
    expect(focusInfo(ARP, 'arp.wave', specs)).toEqual({ visual: 'wave' });
    expect(focusInfo(ARP, 'arp.attack', specs)).toEqual({ visual: 'envelope', role: 'attack' });
    expect(focusInfo(ARP, 'arp.release', specs)).toMatchObject({ visual: 'envelope', role: 'release' });
    expect(focusInfo(ARP, 'arp.cutoffMax', specs)).toMatchObject({ visual: 'filter', feature: 'max' });
    expect(focusInfo(ARP, 'arp.q', specs)).toMatchObject({ visual: 'filter', feature: 'q' });
    expect(focusInfo(ARP, 'arp.filterOctaves', specs)).toMatchObject({ visual: 'filter', feature: 'oct' });
    expect(focusInfo(ARP, 'arp.spread', specs)).toEqual({ visual: 'wave' }); // detune drives the stacked copies
    expect(focusInfo(ARP, 'arp.chorusWet', specs)).toEqual({ visual: null });
    expect(focusInfo(ARP, null, specs)).toEqual({ visual: null });
  });
});

describe('sections', () => {
  it('groups the arp params in a sensible order', () => {
    const secs = buildSections(ARP);
    expect(secs.map((s) => s.id)).toEqual(['osc', 'filter', 'env', 'mod', 'levels']);
    expect(secs[0]!.params.map((p) => p.key)).toEqual(['arp.wave', 'arp.spread']);
    expect(secs[1]!.params.map((p) => p.key)).toContain('arp.filterDecay');
    expect(secs.flatMap((s) => s.params)).toHaveLength(ARP.length);
  });
  it('splits the fx group', () => {
    expect(sectionOf(sl('fx.reverbReturnDb'))).toBe('reverb');
    expect(sectionOf(sl('fx.delayFeedback'))).toBe('echo');
    expect(sectionOf(sl('fx.reverbSend.arp'))).toBe('sends');
    expect(sectionOf(sl('fx.delaySend.arp'))).toBe('echoSends');
    expect(sectionOf(sl('weird.thing'))).toBe('other');
  });
});

describe('meters', () => {
  it('maps linear peak to 0..1', () => {
    expect(levelToMeter(0)).toBe(0);
    expect(levelToMeter(1)).toBe(1);
    expect(levelToMeter(0.5)).toBeGreaterThan(0.8);
    expect(levelToMeter(0.001)).toBeLessThan(0.3);
    expect(levelToMeter(2)).toBe(1);
  });
});
