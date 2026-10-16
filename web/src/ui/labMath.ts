/**
 * Sound Lab visual math: pure functions (no DOM / React / Tone). Everything the dock draws is computed from the
 * *effective* parameter values (override ?? default) through these helpers, so they can be unit-tested.
 */
import type { TuningOption, TuningParam } from '../tuning/schema';

// ---------------------------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Last dotted segment of a key: 'arp.cutoffMax' -> 'cutoffMax'. */
export function lastSegment(key: string): string {
  const i = key.lastIndexOf('.');
  return i < 0 ? key : key.slice(i + 1);
}

// ---------------------------------------------------------------------------------------------
// log-frequency axis
// ---------------------------------------------------------------------------------------------

export const AXIS_MIN_HZ = 20;
export const AXIS_MAX_HZ = 20000;

/** Frequency -> 0..1 on a log axis (clamped). */
export function freqToNorm(f: number, minHz = AXIS_MIN_HZ, maxHz = AXIS_MAX_HZ): number {
  if (!(f > minHz)) return 0;
  if (f >= maxHz) return 1;
  return Math.log(f / minHz) / Math.log(maxHz / minHz);
}

/** 0..1 -> frequency on a log axis. */
export function normToFreq(t: number, minHz = AXIS_MIN_HZ, maxHz = AXIS_MAX_HZ): number {
  return minHz * Math.pow(maxHz / minHz, clamp(t, 0, 1));
}

export function freqToX(f: number, width: number, minHz = AXIS_MIN_HZ, maxHz = AXIS_MAX_HZ): number {
  return freqToNorm(f, minHz, maxHz) * width;
}

export function xToFreq(x: number, width: number, minHz = AXIS_MIN_HZ, maxHz = AXIS_MAX_HZ): number {
  return normToFreq(width > 0 ? x / width : 0, minHz, maxHz);
}

/** "100", "1k", "10k", "2.5k" */
export function formatHzShort(f: number): string {
  if (f >= 1000) {
    const k = f / 1000;
    return `${Number.isInteger(k) ? k : Number(k.toFixed(k < 10 ? 2 : 1))}k`;
  }
  return String(Math.round(f));
}

/** Decade ticks inside the axis range. */
export const FREQ_TICKS: readonly number[] = [50, 100, 500, 1000, 5000, 10000];
export const FREQ_LABELLED_TICKS: readonly number[] = [100, 1000, 10000];

// ---------------------------------------------------------------------------------------------
// spectrum -> columns
// ---------------------------------------------------------------------------------------------

/**
 * For a log-frequency plot `cols` pixels wide, fill `lo[i]`/`hi[i]` with the (fractional) FFT bin range covered by
 * column i. `binCount` bins span 0..sampleRate/2. Used with `sampleSpectrum`.
 */
export function buildSpectrumColumns(
  cols: number,
  binCount: number,
  sampleRate: number,
  lo: Float32Array,
  hi: Float32Array,
  minHz = AXIS_MIN_HZ,
  maxHz = AXIS_MAX_HZ,
): void {
  const binHz = sampleRate / 2 / Math.max(1, binCount);
  const n = Math.min(cols, lo.length, hi.length);
  for (let i = 0; i < n; i++) {
    lo[i] = normToFreq(i / cols, minHz, maxHz) / binHz;
    hi[i] = normToFreq((i + 1) / cols, minHz, maxHz) / binHz;
  }
}

/** dB value of one column: max over the bin range when it spans >1 bin, linear interpolation otherwise. */
export function sampleSpectrum(spec: ArrayLike<number>, lo: number, hi: number): number {
  const n = spec.length;
  if (n === 0) return -Infinity;
  if (hi - lo >= 1) {
    const a = Math.max(0, Math.floor(lo));
    const b = Math.min(n - 1, Math.ceil(hi));
    let m = -Infinity;
    for (let i = a; i <= b; i++) {
      const v = spec[i]!;
      if (v > m) m = v;
    }
    return m;
  }
  const c = clamp((lo + hi) / 2, 0, n - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = c - i0;
  // analysers report -Infinity for silent bins: clamp so the interpolation never produces NaN
  return Math.max(-200, spec[i0]!) * (1 - f) + Math.max(-200, spec[i1]!) * f;
}

// ---------------------------------------------------------------------------------------------
// oscillator waves
// ---------------------------------------------------------------------------------------------

export type WaveKind = NonNullable<TuningOption['wave']>;

export const PULSE_WIDTH = 0.25;

/** One period of a wave at `phase` (cycles, any real number). Result in -1..1. */
export function waveValue(wave: WaveKind, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'sine':
      return Math.sin(p * Math.PI * 2);
    case 'triangle':
      return p < 0.25 ? p * 4 : p < 0.75 ? 2 - p * 4 : p * 4 - 4;
    case 'sawtooth':
      return p * 2 - 1;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'pulse':
      return p < PULSE_WIDTH ? 1 : -1;
    default:
      return 0;
  }
}

/**
 * Relative frequencies of the stacked (unison) copies, spread evenly over 1 +/- detune. One copy -> [1]
 * (a single clean oscillator). The detune is exaggerated on purpose so the beating is visible in a 2-cycle drawing.
 */
export function unisonRatios(count: number, detune: number): number[] {
  const n = Math.max(1, Math.min(7, Math.round(Number.isFinite(count) ? count : 1)));
  if (n === 1) return [1];
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(1 + detune * ((2 * k) / (n - 1) - 1));
  return out;
}

/** Visual detune amount (fraction of the frequency) for a `spread` in cents; unknown spread -> a pleasant default. */
export function visualDetune(spreadCents: number | undefined): number {
  if (spreadCents === undefined || !Number.isFinite(spreadCents)) return 0.035;
  return 0.02 + 0.05 * clamp(spreadCents / 60, 0, 1);
}

/** The 'unison' slider that belongs to a wave param: same trailing digit ('lead.wave0' <-> 'lead.unison0'). */
export function findUnisonParam(params: readonly TuningParam[], waveKey: string): TuningParam | undefined {
  const digits = (k: string) => /\d+$/.exec(lastSegment(k))?.[0] ?? '';
  const want = digits(waveKey);
  return params.find((p) => p.kind !== 'choice' && lastSegment(p.key).toLowerCase().includes('unison') && digits(p.key) === want);
}

/** A group-wide 'spread' (detune in cents) slider, if any. */
export function findSpreadParam(params: readonly TuningParam[]): TuningParam | undefined {
  return params.find((p) => p.kind !== 'choice' && lastSegment(p.key).toLowerCase() === 'spread');
}

/** Fill `out` with `out.length` samples covering `cycles` periods of one (optionally detuned) copy. */
export function sampleWave(wave: WaveKind, cycles: number, ratio: number, out: Float32Array): void {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = waveValue(wave, ((i / Math.max(1, n - 1)) * cycles) * ratio);
}

/** SVG polyline `points` string for a small glyph of one wave cycle (fat = 2 faded outlines are drawn separately). */
export function waveGlyphPoints(wave: WaveKind, width: number, height: number, ratio = 1, cycles = 1.5, steps = 40, pad = 2): string {
  const pts: string[] = [];
  const mid = height / 2;
  const amp = height / 2 - pad;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    // nudge off exact discontinuities so square/saw edges render as vertical strokes, not slanted ones
    const v = waveValue(wave, (i / steps) * cycles * ratio + 1e-6);
    pts.push(`${x.toFixed(1)},${(mid - v * amp).toFixed(1)}`);
  }
  return pts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// envelope
// ---------------------------------------------------------------------------------------------

export type EnvRole = 'attack' | 'decay' | 'sustain' | 'release';

export interface EnvelopeInput {
  attack: number;
  decay: number;
  /** 0..1 */
  sustain: number;
  release: number;
}

export interface EnvelopeShape extends EnvelopeInput {
  /** time when the attack ends (level 1) */
  tAttack: number;
  /** time when the decay ends (level = sustain) */
  tDecay: number;
  /** note-off time */
  tOff: number;
  /** level at note-off */
  levelOff: number;
  /** time when the release ends */
  total: number;
  /** true when the sustain stage is visible (sustain > 0) */
  sustained: boolean;
}

/** Exponential-ish easing used for decay/release: 1 at u=0 -> 0 at u=1. */
export function expFall(u: number): number {
  const c = clamp(u, 0, 1);
  const k = 4;
  return (Math.exp(-k * c) - Math.exp(-k)) / (1 - Math.exp(-k));
}

/**
 * Build the drawable shape. With sustain > 0 the note is held for a while (a quarter of the envelope's total
 * length) before release; a "pluck" (sustain 0) is released halfway through its decay so that the release tail
 * is still visible.
 */
export function envelopeShape(input: EnvelopeInput): EnvelopeShape {
  const attack = Math.max(0, input.attack);
  const decay = Math.max(0, input.decay);
  const release = Math.max(0, input.release);
  const sustain = clamp(input.sustain, 0, 1);
  const tAttack = attack;
  const tDecay = attack + decay;
  const sustained = sustain > 0.001;
  let tOff: number;
  let levelOff: number;
  if (sustained) {
    tOff = tDecay + Math.max(0.05, 0.25 * (tDecay + release));
    levelOff = sustain;
  } else if (release === 0) {
    // percussive one-shot with no release stage: the decay is the whole story
    tOff = tDecay;
    levelOff = 0;
  } else {
    tOff = attack + decay * 0.5;
    levelOff = decay > 0 ? sustain + (1 - sustain) * expFall(0.5) : sustain;
  }
  const total = Math.max(1e-3, tOff + release);
  return { attack, decay, sustain, release, tAttack, tDecay, tOff, levelOff, total, sustained };
}

/** Level 0..1 of the shape at time t (seconds). */
export function envelopeLevel(s: EnvelopeShape, t: number): number {
  if (t <= 0) return 0;
  if (t < s.tAttack) return s.attack > 0 ? t / s.attack : 1;
  if (t < s.tOff) {
    if (t < s.tDecay) {
      const u = s.decay > 0 ? (t - s.tAttack) / s.decay : 1;
      return s.sustain + (1 - s.sustain) * expFall(u);
    }
    return s.sustain;
  }
  if (t >= s.total) return 0;
  const u = s.release > 0 ? (t - s.tOff) / s.release : 1;
  return s.levelOff * expFall(u);
}

/** Which envelope stage does this key control? Filter envelopes ('filterDecay') are excluded. */
export function envelopeRole(key: string): EnvRole | null {
  const seg = lastSegment(key).toLowerCase();
  if (seg.startsWith('filter')) return null;
  if (seg.endsWith('attack')) return 'attack';
  if (seg.endsWith('decay')) return 'decay';
  if (seg.endsWith('sustain')) return 'sustain';
  if (seg.endsWith('release')) return 'release';
  return null;
}

export interface EnvelopeSpec {
  /** key controlling each role (undefined = missing) */
  keys: Partial<Record<EnvRole, string>>;
  count: number;
}

/** Find the envelope params of a group (exact 'decay' beats e.g. 'kickDecay'; first match otherwise). */
export function findEnvelopeParams(params: readonly TuningParam[]): EnvelopeSpec {
  const keys: Partial<Record<EnvRole, string>> = {};
  const exact: Partial<Record<EnvRole, boolean>> = {};
  for (const p of params) {
    if (p.kind === 'choice') continue;
    const role = envelopeRole(p.key);
    if (!role) continue;
    const isExact = lastSegment(p.key).toLowerCase() === role;
    if (keys[role] === undefined || (isExact && !exact[role])) {
      keys[role] = p.key;
      exact[role] = isExact;
    }
  }
  return { keys, count: Object.keys(keys).length };
}

/** Resolve missing stages: attack 2 ms; decay absent -> sustained (no decay stage); sustain absent -> pluck (0) when a decay exists. */
export function envelopeInputFromValues(spec: EnvelopeSpec, get: (key: string) => number): EnvelopeInput {
  const k = spec.keys;
  const attack = k.attack ? get(k.attack) : 0.002;
  const decay = k.decay ? get(k.decay) : 0;
  const release = k.release ? get(k.release) : 0;
  let sustain: number;
  if (k.sustain) sustain = get(k.sustain);
  else sustain = k.decay ? 0 : 1;
  return { attack, decay, sustain, release };
}

/** Which role segment [t0,t1] to highlight. */
export function envelopeSegment(s: EnvelopeShape, role: EnvRole): [number, number] {
  switch (role) {
    case 'attack':
      return [0, s.tAttack];
    case 'decay':
      return [s.tAttack, s.tDecay];
    case 'sustain':
      return [s.tDecay, s.tOff];
    case 'release':
      return [s.tOff, s.total];
  }
}

// ---------------------------------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------------------------------

/** Magnitude (linear) of a 2nd-order low-pass section at x = f / fc. */
function lp2(x: number, q: number): number {
  const a = 1 - x * x;
  const b = x / q;
  return 1 / Math.sqrt(a * a + b * b);
}

/**
 * Approximate 4-pole (-24 dB/oct) low-pass response in dB: one resonant section (Q = q) cascaded with one
 * Butterworth-ish section (Q = 0.7071). Peak near fc grows with q; for q <= 0.71 the curve is monotonic.
 */
export function lowpassDb(f: number, fc: number, q: number): number {
  const x = Math.max(1e-6, f / Math.max(1, fc));
  const m = lp2(x, Math.max(0.1, q)) * lp2(x, Math.SQRT1_2);
  return 20 * Math.log10(Math.max(1e-6, m));
}

/** 4-pole high-pass (mirror image of the low-pass around fc). */
export function highpassDb(f: number, fc: number, q: number): number {
  return lowpassDb((fc * fc) / Math.max(1e-6, f), fc, q);
}

export interface FilterKeys {
  min?: string;
  max?: string;
  cut?: string;
  oct?: string;
  q?: string;
}

export interface FilterSpec {
  id: string;
  label: string;
  type: 'lp' | 'hp';
  cutMin: number;
  cutMax: number;
  q: number;
  /** filter-envelope sweep in octaves (0 = none / unknown) */
  octaves: number;
  keys: FilterKeys;
}

export type Getter = (key: string) => number;

/**
 * Collect the filters of a group from its params (generic, key-name driven):
 *  - `<prefix>cutoffMin` / `<prefix>cutoffMax` pairs (prefix '' -> the instrument's main filter, 'noise'/'drone' ...)
 *  - single cutoffs: '*LpHz', '*HpHz', 'ceilingHz'
 *  - 'q' / '*resonance' (shared), '<prefix>filterOctaves' (sweep).
 */
export function buildFilterSpecs(params: readonly TuningParam[], get: Getter, groupLabel = 'Filter'): FilterSpec[] {
  interface Acc {
    prefix: string;
    type: 'lp' | 'hp';
    label: string;
    keys: FilterKeys;
  }
  const accs = new Map<string, Acc>();
  const order: string[] = [];
  const touch = (id: string, prefix: string, type: 'lp' | 'hp', label: string): Acc => {
    let a = accs.get(id);
    if (!a) {
      a = { prefix, type, label, keys: {} };
      accs.set(id, a);
      order.push(id);
    }
    return a;
  };
  let sharedQ: string | undefined;
  const octs = new Map<string, string>();

  for (const p of params) {
    if (p.kind === 'choice') continue;
    const seg = lastSegment(p.key);
    const lower = seg.toLowerCase();
    let m: RegExpMatchArray | null;
    if ((m = /^(.*?)cutoffmax$/.exec(lower))) {
      const a = touch(`pair:${m[1]}`, m[1]!, 'lp', m[1] ? cap(m[1]) : groupLabel);
      a.keys.max = p.key;
    } else if ((m = /^(.*?)cutoffmin$/.exec(lower))) {
      const a = touch(`pair:${m[1]}`, m[1]!, 'lp', m[1] ? cap(m[1]) : groupLabel);
      a.keys.min = p.key;
    } else if (lower === 'q' || lower.endsWith('resonance')) {
      sharedQ = sharedQ ?? p.key;
    } else if ((m = /^(.*?)filteroctaves$/.exec(lower))) {
      octs.set(m[1]!, p.key);
    } else if (lower.endsWith('lphz') || lower === 'ceilinghz') {
      touch(`single:${p.key}`, '', 'lp', p.label).keys.cut = p.key;
    } else if (lower.endsWith('hphz')) {
      touch(`single:${p.key}`, '', 'hp', p.label).keys.cut = p.key;
    }
  }

  const out: FilterSpec[] = [];
  for (const id of order) {
    const a = accs.get(id)!;
    const keys = a.keys;
    let lo: number;
    let hi: number;
    if (keys.cut) {
      lo = hi = get(keys.cut);
    } else if (keys.min && keys.max) {
      lo = get(keys.min);
      hi = get(keys.max);
    } else if (keys.max) {
      lo = hi = get(keys.max);
    } else if (keys.min) {
      lo = hi = get(keys.min);
    } else continue;
    if (lo > hi) [lo, hi] = [hi, lo];
    const oct = octs.get(a.prefix);
    if (oct) keys.oct = oct;
    if (sharedQ && !keys.cut) keys.q = sharedQ;
    out.push({
      id,
      label: a.label,
      type: a.type,
      cutMin: lo,
      cutMax: hi,
      q: keys.q ? get(keys.q) : Math.SQRT1_2,
      octaves: keys.oct ? Math.max(0, get(keys.oct)) : 0,
      keys,
    });
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------------------------
// waves in a group
// ---------------------------------------------------------------------------------------------

/** Choice params that describe an oscillator shape. */
export function findWaveParams(params: readonly TuningParam[]): TuningParam[] {
  return params.filter((p) => p.kind === 'choice' && (p.visual === 'wave' || (p.options ?? []).some((o) => o.wave !== undefined)));
}

/** Option whose value is nearest to `value` (undefined if there are no options). */
export function findOption(param: TuningParam, value: number): TuningOption | undefined {
  const opts = param.options;
  if (!opts || opts.length === 0) return undefined;
  let best = opts[0]!;
  let bd = Math.abs(best.value - value);
  for (const o of opts) {
    const d = Math.abs(o.value - value);
    if (d < bd) {
      best = o;
      bd = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// focus mapping: which visual / feature does a param drive?
// ---------------------------------------------------------------------------------------------

export type VisualId = 'wave' | 'envelope' | 'filter';

export interface FocusInfo {
  visual: VisualId | null;
  /** envelope stage */
  role?: EnvRole;
  /** filter spec id + feature */
  filterId?: string;
  feature?: 'min' | 'max' | 'cut' | 'q' | 'oct';
}

export function focusInfo(params: readonly TuningParam[], key: string | null, specs: readonly FilterSpec[]): FocusInfo {
  if (!key) return { visual: null };
  const p = params.find((x) => x.key === key);
  if (!p) return { visual: null };
  if (p.kind === 'choice' && findWaveParams([p]).length > 0) return { visual: 'wave' };
  const waves = findWaveParams(params);
  if (waves.length > 0 && (findSpreadParam(params)?.key === key || waves.some((w) => findUnisonParam(params, w.key)?.key === key))) {
    return { visual: 'wave' };
  }
  for (const s of specs) {
    const k = s.keys;
    const feature = k.min === key ? 'min' : k.max === key ? 'max' : k.cut === key ? 'cut' : k.q === key ? 'q' : k.oct === key ? 'oct' : null;
    if (feature) return { visual: 'filter', filterId: s.id, feature };
  }
  const role = envelopeRole(key);
  if (role) return { visual: 'envelope', role };
  // schema hint as the fallback (e.g. a param tagged 'filter' that we could not map to a spec)
  return { visual: p.visual ?? null };
}

// ---------------------------------------------------------------------------------------------
// sections (visual sub-grouping of a group's params)
// ---------------------------------------------------------------------------------------------

export type SectionId = 'osc' | 'filter' | 'env' | 'mod' | 'levels' | 'reverb' | 'echo' | 'sends' | 'echoSends' | 'other';

export const SECTION_LABEL: Record<SectionId, string> = {
  osc: 'Oscillator',
  filter: 'Filter',
  env: 'Envelope',
  mod: 'Movement & FX',
  levels: 'Levels',
  reverb: 'Reverb',
  echo: 'Echo',
  sends: 'Reverb sends',
  echoSends: 'Echo sends',
  other: 'Tone & shape',
};

const SECTION_ORDER: readonly SectionId[] = ['osc', 'filter', 'env', 'mod', 'levels', 'reverb', 'echo', 'sends', 'echoSends', 'other'];

export function sectionOf(p: TuningParam): SectionId {
  const key = p.key;
  const lower = key.toLowerCase();
  const seg = lastSegment(key).toLowerCase();
  if (lower.includes('.reverbsend.')) return 'sends';
  if (lower.includes('.delaysend.')) return 'echoSends';
  if (lower.startsWith('fx.')) {
    if (seg.startsWith('reverb')) return 'reverb';
    if (seg.startsWith('delay')) return 'echo';
  }
  if (p.kind === 'choice' || p.visual === 'wave') return 'osc';
  if (p.visual === 'filter') return 'filter';
  if (/cutoff|^q$|resonance|lphz|hphz|ceilinghz|filteroctaves|filterdecay/.test(seg)) return 'filter';
  if (p.visual === 'envelope' || envelopeRole(key)) return 'env';
  if (/spread|harmonicity|detune|voices|width|unison|pulse/.test(seg)) return 'osc';
  if (/vibrato|lfo|chorus|portamento|glide|pan|drive|mod/.test(seg)) return 'mod';
  if (/db$|level|gain|volume|sub$/.test(seg)) return 'levels';
  return 'other';
}

export interface Section {
  id: SectionId;
  label: string;
  params: TuningParam[];
}

/** Split a group's params into ordered, non-empty sections (stable within a section). */
export function buildSections(params: readonly TuningParam[]): Section[] {
  const buckets = new Map<SectionId, TuningParam[]>();
  for (const p of params) {
    const id = sectionOf(p);
    const arr = buckets.get(id);
    if (arr) arr.push(p);
    else buckets.set(id, [p]);
  }
  const out: Section[] = [];
  for (const id of SECTION_ORDER) {
    const arr = buckets.get(id);
    if (arr && arr.length > 0) out.push({ id, label: SECTION_LABEL[id], params: arr });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// meters
// ---------------------------------------------------------------------------------------------

/** Linear peak 0..1 -> meter fill 0..1 on a -48..0 dB scale. */
export function levelToMeter(level: number): number {
  if (!(level > 0)) return 0;
  const db = 20 * Math.log10(level);
  return clamp((db + 48) / 48, 0, 1);
}
