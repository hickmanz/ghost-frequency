/**
 * Canvas painters for the Sound Lab visuals. DOM-light: they only touch the 2D context they are given.
 * The "live" painters (scope, spectrum) keep their buffers in classes and allocate nothing per frame; the
 * "static" painters (wave / envelope / filter) only run when a parameter, hover target or size changed.
 */
import { dbToUnit, smoothValue } from './visualizerMath';
import {
  AXIS_MAX_HZ,
  AXIS_MIN_HZ,
  FREQ_LABELLED_TICKS,
  FREQ_TICKS,
  buildSpectrumColumns,
  envelopeLevel,
  envelopeSegment,
  formatHzShort,
  freqToX,
  highpassDb,
  lowpassDb,
  sampleSpectrum,
  waveValue,
  xToFreq,
  type EnvRole,
  type EnvelopeShape,
  type FilterSpec,
  type FocusInfo,
  type WaveKind,
} from './labMath';

export const COLOR = {
  bg: '#05010f',
  grid: 'rgba(139, 92, 255, 0.16)',
  gridStrong: 'rgba(139, 92, 255, 0.34)',
  text: 'rgba(200, 192, 240, 0.78)',
  textDim: 'rgba(143, 134, 192, 0.8)',
  cyan: '#19e6ff',
  magenta: '#ff2bd6',
  violet: '#8b5cff',
  warn: '#ffd23d',
  ok: '#3dffb0',
} as const;

const FILTER_COLORS = [COLOR.cyan, COLOR.magenta, COLOR.warn, COLOR.ok] as const;
const FONT = '10px ui-monospace, "Cascadia Code", Consolas, monospace';

export function fmtSec(v: number): string {
  if (v >= 10) return `${v.toFixed(0)}s`;
  if (v >= 1) return `${v.toFixed(1)}s`;
  if (v >= 0.1) return `${v.toFixed(2)}s`;
  return `${Math.round(v * 1000)}ms`;
}

function clearBg(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, w, h);
}

function centerMessage(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(text, w / 2, h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------------------------
// live scope
// ---------------------------------------------------------------------------------------------

export class ScopeView {
  private gain = 1;

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, data: Float32Array | null, dtMs: number, idleText: string): void {
    clearBg(ctx, w, h);
    const mid = h / 2;
    // centre line + quarter lines
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.moveTo(0, h * 0.2);
    ctx.lineTo(w, h * 0.2);
    ctx.moveTo(0, h * 0.8);
    ctx.lineTo(w, h * 0.8);
    ctx.stroke();

    const n = data ? data.length : 0;
    if (!data || n < 16) {
      centerMessage(ctx, w, h, idleText);
      return;
    }

    // trigger on a rising zero crossing in the first half so the picture holds still
    const half = n >> 1;
    let start = 0;
    for (let i = 1; i < half; i++) {
      if (data[i - 1]! < 0 && data[i]! >= 0) {
        start = i;
        break;
      }
    }
    const win = Math.max(8, Math.min(n - start, half));
    let peak = 0;
    for (let i = 0; i < win; i++) {
      const a = Math.abs(data[start + i]!);
      if (a > peak) peak = a;
    }
    if (peak < 2e-4) {
      centerMessage(ctx, w, h, idleText);
      return;
    }
    // auto gain: drop instantly when it would clip, rise slowly
    const target = Math.min(16, 0.9 / peak);
    this.gain = target < this.gain ? target : smoothValue(this.gain, target, dtMs, 400, 400);
    const amp = (h / 2 - 5) * this.gain;

    ctx.beginPath();
    const px = Math.max(1, Math.floor(w));
    for (let x = 0; x <= px; x++) {
      const idx = start + Math.round((x / px) * (win - 1));
      const y = mid - data[idx]! * amp;
      if (x === 0) ctx.moveTo(0, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLOR.cyan;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------
// live spectrum (log frequency axis, smoothing + peak hold)
// ---------------------------------------------------------------------------------------------

const SPEC_FLOOR_DB = -90;
const SPEC_CEIL_DB = -15;
const AXIS_H = 12;
const PEAK_HOLD_MS = 700;
const PEAK_FALL_PER_MS = 0.0006;

interface TickLabel {
  x: number;
  text: string;
}

export class SpectrumView {
  private cols = new Float32Array(0);
  private peaks = new Float32Array(0);
  private holdUntil = new Float64Array(0);
  private lo = new Float32Array(0);
  private hi = new Float32Array(0);
  private colN = 0;
  private bins = 0;
  private sr = 0;
  private fillGrad: CanvasGradient | null = null;
  private ticks: number[] = [];
  private labels: TickLabel[] = [];
  private plotH = 0;
  private layoutW = -1;
  private layoutH = -1;

  private layout(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.colN = Math.max(8, Math.floor(w));
    if (this.cols.length < this.colN) {
      this.cols = new Float32Array(this.colN);
      this.peaks = new Float32Array(this.colN);
      this.holdUntil = new Float64Array(this.colN);
      this.lo = new Float32Array(this.colN);
      this.hi = new Float32Array(this.colN);
    }
    this.cols.fill(0);
    this.peaks.fill(0);
    this.bins = 0; // force column rebuild
    this.plotH = h - AXIS_H;
    const g = ctx.createLinearGradient(0, 0, 0, this.plotH);
    g.addColorStop(0, 'rgba(255, 43, 214, 0.55)');
    g.addColorStop(1, 'rgba(25, 230, 255, 0.08)');
    this.fillGrad = g;
    this.ticks = FREQ_TICKS.map((f) => freqToX(f, w));
    this.labels = FREQ_LABELLED_TICKS.map((f) => ({ x: freqToX(f, w), text: formatHzShort(f) }));
  }

  draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    spec: Float32Array | null,
    sampleRate: number,
    now: number,
    dtMs: number,
    idleText: string,
  ): void {
    if (w !== this.layoutW || h !== this.layoutH) {
      this.layout(ctx, w, h);
      this.layoutW = w;
      this.layoutH = h;
    }
    clearBg(ctx, w, h);
    const plotH = this.plotH;

    // grid + axis labels
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.ticks.length; i++) {
      const x = Math.round(this.ticks[i]!) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH);
    }
    ctx.moveTo(0, plotH + 0.5);
    ctx.lineTo(w, plotH + 0.5);
    ctx.stroke();
    ctx.font = FONT;
    ctx.fillStyle = COLOR.textDim;
    ctx.textAlign = 'center';
    for (let i = 0; i < this.labels.length; i++) ctx.fillText(this.labels[i]!.text, this.labels[i]!.x, h - 2);
    ctx.textAlign = 'left';

    const live = spec !== null && spec.length >= 2;
    if (live) {
      if (spec.length !== this.bins || sampleRate !== this.sr) {
        buildSpectrumColumns(this.colN, spec.length, sampleRate, this.lo, this.hi);
        this.bins = spec.length;
        this.sr = sampleRate;
      }
    }
    const n = this.colN;
    const cols = this.cols;
    const peaks = this.peaks;
    const hold = this.holdUntil;
    let any = 0;
    for (let i = 0; i < n; i++) {
      const target = live ? dbToUnit(sampleSpectrum(spec, this.lo[i]!, this.hi[i]!), SPEC_FLOOR_DB, SPEC_CEIL_DB) : 0;
      const c = smoothValue(cols[i]!, target, dtMs, 35, 240);
      cols[i] = c;
      if (c >= peaks[i]!) {
        peaks[i] = c;
        hold[i] = now + PEAK_HOLD_MS;
      } else if (now > hold[i]!) {
        const p = peaks[i]! - dtMs * PEAK_FALL_PER_MS;
        peaks[i] = p > c ? p : c;
      }
      if (c > 0.01) any = 1;
    }

    if (!any) {
      centerMessage(ctx, w, plotH, idleText);
      return;
    }

    const scale = w / n;
    const top = plotH * 0.96;
    ctx.beginPath();
    ctx.moveTo(0, plotH);
    for (let i = 0; i < n; i++) ctx.lineTo((i + 0.5) * scale, plotH - cols[i]! * top);
    ctx.lineTo(w, plotH);
    ctx.closePath();
    ctx.fillStyle = this.fillGrad!;
    ctx.fill();
    ctx.strokeStyle = COLOR.cyan;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // peak hold ticks
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = peaks[i]!;
      if (p > cols[i]! + 0.015 && p > 0.02) {
        const y = plotH - p * top;
        ctx.moveTo(i * scale, y);
        ctx.lineTo((i + 1) * scale, y);
      }
    }
    ctx.strokeStyle = COLOR.warn;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// wave shape preview
// ---------------------------------------------------------------------------------------------

export interface WaveLane {
  label: string;
  wave: WaveKind;
  /** relative frequencies of the stacked copies (length 1 = single oscillator) */
  ratios: readonly number[];
  highlight: boolean;
}

const WAVE_CYCLES = 2.5;

export function drawWaves(ctx: CanvasRenderingContext2D, w: number, h: number, lanes: readonly WaveLane[]): void {
  clearBg(ctx, w, h);
  if (lanes.length === 0) {
    centerMessage(ctx, w, h, 'no waveform choice here');
    return;
  }
  const laneH = h / lanes.length;
  const step = 2;
  for (let li = 0; li < lanes.length; li++) {
    const lane = lanes[li]!;
    const top = li * laneH;
    const mid = top + laneH / 2;
    const amp = laneH / 2 - 9;
    if (li > 0) {
      ctx.strokeStyle = COLOR.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top + 0.5);
      ctx.lineTo(w, top + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.stroke();

    // stacked (unison) copies first, faded; the exact-pitch reference wave is always drawn last, on top
    const copies = lane.ratios.length > 1 ? lane.ratios.length : 0;
    for (let r = 0; r <= copies; r++) {
      const main = r === copies;
      const ratio = main ? 1 : lane.ratios[r]!;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        const v = waveValue(lane.wave, (x / w) * WAVE_CYCLES * ratio + 1e-6);
        const y = mid - v * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineJoin = 'round';
      if (main) {
        ctx.strokeStyle = lane.highlight ? COLOR.magenta : COLOR.cyan;
        if (lane.highlight) {
          ctx.globalAlpha = 0.3;
          ctx.lineWidth = 6;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.strokeStyle = COLOR.violet;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.font = FONT;
    ctx.fillStyle = lane.highlight ? COLOR.magenta : COLOR.text;
    ctx.fillText(lane.label, 5, top + 11);
  }
}

// ---------------------------------------------------------------------------------------------
// envelope diagram
// ---------------------------------------------------------------------------------------------

const ENV_PAD = { l: 8, r: 8, t: 20, b: 14 } as const;

export function drawEnvelope(ctx: CanvasRenderingContext2D, w: number, h: number, s: EnvelopeShape, role: EnvRole | null): void {
  clearBg(ctx, w, h);
  const pw = Math.max(10, w - ENV_PAD.l - ENV_PAD.r);
  const ph = Math.max(10, h - ENV_PAD.t - ENV_PAD.b);
  const base = ENV_PAD.t + ph;
  const tx = (t: number) => ENV_PAD.l + (t / s.total) * pw;
  const ly = (v: number) => base - v * ph;

  // axis
  ctx.strokeStyle = COLOR.gridStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ENV_PAD.l, base + 0.5);
  ctx.lineTo(w - ENV_PAD.r, base + 0.5);
  ctx.moveTo(ENV_PAD.l + 0.5, ENV_PAD.t - 4);
  ctx.lineTo(ENV_PAD.l + 0.5, base);
  ctx.stroke();

  const draw = (t0: number, t1: number) => {
    const x0 = Math.floor(tx(t0));
    const x1 = Math.ceil(tx(t1));
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const t = ((x - ENV_PAD.l) / pw) * s.total;
      const y = ly(envelopeLevel(s, Math.min(Math.max(t, t0), t1)));
      if (x === x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  // filled body
  draw(0, s.total);
  ctx.lineTo(tx(s.total), base);
  ctx.lineTo(ENV_PAD.l, base);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, ENV_PAD.t, 0, base);
  grad.addColorStop(0, 'rgba(25, 230, 255, 0.35)');
  grad.addColorStop(1, 'rgba(139, 92, 255, 0.04)');
  ctx.fillStyle = grad;
  ctx.fill();
  draw(0, s.total);
  ctx.strokeStyle = COLOR.cyan;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // note-off marker
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = COLOR.textDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx(s.tOff) + 0.5, ENV_PAD.t - 2);
  ctx.lineTo(tx(s.tOff) + 0.5, base);
  ctx.stroke();
  ctx.setLineDash([]);

  // highlighted stage
  if (role) {
    const [a, b] = envelopeSegment(s, role);
    if (b > a) {
      draw(a, b);
      ctx.strokeStyle = COLOR.magenta;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
  }

  // corner points + labels
  ctx.font = FONT;
  const dot = (t: number, v: number, on: boolean) => {
    ctx.beginPath();
    ctx.arc(tx(t), ly(v), on ? 3.6 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = on ? COLOR.magenta : '#fff';
    ctx.fill();
  };
  // legend row (no overlap, whatever the proportions): A / D / S / R values, the active stage in magenta
  let lx = ENV_PAD.l + 2;
  const legend = (text: string, on: boolean) => {
    ctx.fillStyle = on ? COLOR.magenta : COLOR.text;
    ctx.fillText(text, lx, 12);
    lx += ctx.measureText(text).width + 10;
  };
  dot(s.tAttack, 1, role === 'attack');
  legend(`A ${fmtSec(s.attack)}`, role === 'attack');
  if (s.decay > 0) {
    dot(s.tDecay, s.sustained ? s.sustain : envelopeLevel(s, s.tDecay), role === 'decay');
    legend(`D ${fmtSec(s.decay)}`, role === 'decay');
  }
  if (s.sustained) legend(`S ${Math.round(s.sustain * 100)}%`, role === 'sustain');
  dot(s.tOff, s.levelOff, role === 'release');
  if (s.release > 0) legend(`R ${fmtSec(s.release)}`, role === 'release');

  // time axis
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText('0', ENV_PAD.l, h - 3);
  const end = fmtSec(s.total);
  ctx.fillText(end, w - ENV_PAD.r - ctx.measureText(end).width, h - 3);
}

// ---------------------------------------------------------------------------------------------
// filter curve
// ---------------------------------------------------------------------------------------------

const DB_TOP = 20;
const DB_BOTTOM = -50;
const F_PAD = { l: 6, r: 6, t: 12, b: 14 } as const;

export function drawFilters(ctx: CanvasRenderingContext2D, w: number, h: number, specs: readonly FilterSpec[], focus: FocusInfo): void {
  clearBg(ctx, w, h);
  const pw = w - F_PAD.l - F_PAD.r;
  const ph = h - F_PAD.t - F_PAD.b;
  const base = F_PAD.t + ph;
  const fx = (f: number) => F_PAD.l + freqToX(f, pw);
  const dy = (db: number) => F_PAD.t + ((DB_TOP - Math.max(DB_BOTTOM, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOTTOM)) * ph;

  // grid: decade ticks, 0 dB line
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.grid;
  ctx.beginPath();
  for (const f of FREQ_TICKS) {
    const x = Math.round(fx(f)) + 0.5;
    ctx.moveTo(x, F_PAD.t);
    ctx.lineTo(x, base);
  }
  ctx.stroke();
  ctx.strokeStyle = COLOR.gridStrong;
  ctx.beginPath();
  ctx.moveTo(F_PAD.l, Math.round(dy(0)) + 0.5);
  ctx.lineTo(w - F_PAD.r, Math.round(dy(0)) + 0.5);
  ctx.moveTo(F_PAD.l, base + 0.5);
  ctx.lineTo(w - F_PAD.r, base + 0.5);
  ctx.stroke();
  ctx.font = FONT;
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = 'center';
  for (const f of FREQ_LABELLED_TICKS) ctx.fillText(formatHzShort(f), fx(f), h - 3);
  ctx.textAlign = 'left';
  ctx.fillText('0 dB', F_PAD.l + 2, dy(0) - 2);

  const curve = (spec: FilterSpec, fc: number) => {
    ctx.beginPath();
    for (let x = 0; x <= pw; x++) {
      const f = xToFreq(x, pw, AXIS_MIN_HZ, AXIS_MAX_HZ);
      const db = spec.type === 'lp' ? lowpassDb(f, fc, spec.q) : highpassDb(f, fc, spec.q);
      const y = dy(db);
      if (x === 0) ctx.moveTo(F_PAD.l, y);
      else ctx.lineTo(F_PAD.l + x, y);
    }
  };

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const color = FILTER_COLORS[i % FILTER_COLORS.length]!;
    const mine = focus.visual === 'filter' && focus.filterId === spec.id ? focus.feature : undefined;
    const band = spec.cutMax > spec.cutMin * 1.02;

    // swept range band
    if (band) {
      const x0 = fx(spec.cutMin);
      const x1 = fx(spec.cutMax);
      ctx.globalAlpha = mine === 'min' || mine === 'max' ? 0.24 : 0.13;
      ctx.fillStyle = color;
      ctx.fillRect(x0, F_PAD.t, x1 - x0, ph);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x0) + 0.5, F_PAD.t);
      ctx.lineTo(Math.round(x0) + 0.5, base);
      ctx.moveTo(Math.round(x1) + 0.5, F_PAD.t);
      ctx.lineTo(Math.round(x1) + 0.5, base);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // closed (min) response, dashed
      curve(spec, spec.cutMin);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = mine === 'min' ? 1 : 0.5;
      ctx.lineWidth = mine === 'min' ? 2.4 : 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    const liveFc = spec.liveCutHz;
    const open = liveFc !== undefined && liveFc > 0 ? liveFc : spec.cutMax;
    curve(spec, open);
    const y0 = dy(0);
    ctx.lineTo(F_PAD.l + pw, y0);
    ctx.lineTo(F_PAD.l, y0);
    ctx.closePath();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    curve(spec, open);
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    const hot = mine === 'max' || mine === 'cut' || mine === 'q';
    if (hot) {
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = hot ? 2.8 : 1.8;
    ctx.stroke();

    // cutoff marker + label (live composer position when set)
    const cx = fx(open);
    const peakDb = Math.max(0, spec.type === 'lp' ? lowpassDb(open, open, spec.q) : highpassDb(open, open, spec.q));
    ctx.beginPath();
    ctx.arc(cx, dy(peakDb), liveFc !== undefined ? 4.5 : mine === 'q' ? 4.2 : 2.8, 0, Math.PI * 2);
    ctx.fillStyle = liveFc !== undefined ? COLOR.violet : mine === 'q' ? COLOR.magenta : '#fff';
    ctx.fill();
    if (liveFc !== undefined && band && Math.abs(open - spec.cutMax) > spec.cutMax * 0.02) {
      curve(spec, spec.cutMax);
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    if (specs.length === 1) {
      const txt = `${formatHzShort(open)}Hz`;
      const tw = ctx.measureText(txt).width;
      ctx.fillText(txt, Math.min(Math.max(cx - tw / 2, 2), w - tw - 2), Math.max(F_PAD.t + 8, dy(peakDb) - 6));
    }

    // filter-envelope sweep arrow (cutoff opens by `octaves` above its base)
    if (spec.octaves > 0.01 && spec.type === 'lp') {
      const aStart = fx(spec.cutMin);
      const aEnd = fx(Math.min(AXIS_MAX_HZ, spec.cutMin * Math.pow(2, spec.octaves)));
      const ay = F_PAD.t + 6 + i * 7;
      if (aEnd - aStart > 3) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = mine === 'oct' ? 3 : 1.4;
        ctx.globalAlpha = mine === 'oct' ? 1 : 0.8;
        ctx.beginPath();
        ctx.moveTo(aStart, ay);
        ctx.lineTo(aEnd, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(aEnd + 1, ay);
        ctx.lineTo(aEnd - 5, ay - 3.5);
        ctx.lineTo(aEnd - 5, ay + 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (specs.length > 1) {
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(`${spec.label} ${formatHzShort(spec.cutMax)}Hz`, w - F_PAD.r - 2, F_PAD.t + 8 + i * 10);
      ctx.textAlign = 'left';
    }
  }
}
