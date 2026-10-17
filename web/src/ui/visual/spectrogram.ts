import { useStore } from '../../services/store';
import { getLabSource } from '../labSource';
import { getVisualizerSource } from '../visualizerSource';
import { dbToUnit, smoothValue } from '../visualizerMath';
import type { SceneFactory, SceneInstance } from './canvasScene';
import {
  FREQ_TICKS,
  RAMP_SIZE,
  SPEC_DB_CEIL,
  SPEC_DB_FLOOR,
  SPEC_WINDOW_SEC,
  buildColorRamp,
  buildRowMap,
  freqToUnit,
  isLittleEndian,
  levelToMeter,
  sampleRowDb,
  spectrogramGrid,
  unitToColorIndex,
} from './spectrogramMath';

const ML = 40; // left margin (frequency labels)
const MR = 14; // right margin (level meter)
const MT = 10;
const MB = 18; // bottom margin (time labels)

const TIME_TICKS = 4;
const TIME_LABELS: string[] = [];
for (let i = 0; i < TIME_TICKS; i++) TIME_LABELS.push(`-${Math.round((SPEC_WINDOW_SEC * (TIME_TICKS - i)) / TIME_TICKS)}s`);

/** smoothing (ms) of the displayed dB values */
const ATTACK_MS = 18;
const DECAY_MS = 150;
/** gentle HF tilt (music spectra fall ~4.5 dB/oct) as a multiplier at the top row */
const TILT = 0.28;

export const createSpectrogramScene: SceneFactory = (ctx): SceneInstance => {
  const little = isLittleEndian();
  const ramp = new Uint32Array(RAMP_SIZE);
  buildColorRamp(ramp, little);
  const black = ramp[0]!;

  // size-dependent state
  let W = 1;
  let H = 1;
  let dpr = 1;
  let px = ML;
  let py = MT;
  let pw = 1;
  let ph = 1;
  let cols = 64;
  let rows = 48;
  let img: ImageData | null = null;
  let px32 = new Uint32Array(0);
  let off: HTMLCanvasElement | null = null;
  let offCtx: CanvasRenderingContext2D | null = null;
  let head = 0; // next column to write == oldest column
  let frac = 0; // progress (0..1) toward the next column
  let smoothed = new Float32Array(rows);
  let rowA = new Uint16Array(rows);
  let rowB = new Uint16Array(rows);
  let rowF = new Float32Array(rows);
  let meterGrad: CanvasGradient | null = null;

  // spectrum-dependent state
  let mapBins = 0;
  let mapSr = 0;
  let level = 0;
  let peak = 0;
  let secPerCol = SPEC_WINDOW_SEC / cols;

  const rebuildMap = (binCount: number, sr: number) => {
    mapBins = binCount;
    mapSr = sr;
    buildRowMap(rows, binCount, sr, rowA, rowB, rowF);
  };

  const resize = (w: number, h: number, ratio: number) => {
    W = w;
    H = h;
    dpr = ratio;
    px = ML;
    py = MT;
    pw = Math.max(40, w - ML - MR);
    ph = Math.max(40, h - MT - MB);
    const g = spectrogramGrid(pw, ph);
    cols = g.cols;
    rows = g.rows;
    secPerCol = SPEC_WINDOW_SEC / cols;
    img = ctx.createImageData(cols * 2, rows);
    px32 = new Uint32Array(img.data.buffer);
    px32.fill(black);
    off = document.createElement('canvas');
    off.width = cols * 2;
    off.height = rows;
    offCtx = off.getContext('2d');
    offCtx?.putImageData(img, 0, 0);
    head = 0;
    frac = 0;
    smoothed = new Float32Array(rows);
    rowA = new Uint16Array(rows);
    rowB = new Uint16Array(rows);
    rowF = new Float32Array(rows);
    mapBins = 0; // force rebuild on next spectrum
    const grad = ctx.createLinearGradient(0, py + ph, 0, py);
    grad.addColorStop(0, '#19e6ff');
    grad.addColorStop(0.6, '#ff2bd6');
    grad.addColorStop(0.85, '#ff9a3d');
    grad.addColorStop(1, '#ffffff');
    meterGrad = grad;
  };

  /** Update smoothed row values + level from the live spectrum (or a faint idle pattern). */
  const updateRows = (dt: number, playing: boolean, now: number): void => {
    const src = playing ? getVisualizerSource() : null;
    let spec: Float32Array | null = src ? src.getSpectrum() : null;
    if (spec && spec.length < 4) spec = null;
    const denom = Math.max(1, rows - 1);
    if (spec) {
      if (spec.length !== mapBins) rebuildMap(spec.length, getLabSource()?.getSampleRate() ?? 44100);
      else if (mapSr === 0) rebuildMap(spec.length, 44100);
      for (let r = 0; r < rows; r++) {
        const unit = dbToUnit(sampleRowDb(spec, rowA, rowB, rowF, r), SPEC_DB_FLOOR, SPEC_DB_CEIL);
        const target = Math.min(1, unit * (1 + TILT * (r / denom)));
        smoothed[r] = smoothValue(smoothed[r]!, target, dt, ATTACK_MS, DECAY_MS);
      }
    } else {
      // idle: a very faint slow travelling shimmer (stays in the black/indigo part of the ramp)
      for (let r = 0; r < rows; r++) {
        const target = 0.035 + 0.03 * Math.sin(now * 0.0006 + r * 0.19) * Math.sin(now * 0.0004 - r * 0.07);
        smoothed[r] = smoothValue(smoothed[r]!, target, dt, 250, 400);
      }
    }
    const l = src ? src.getLevel() : 0;
    level = smoothValue(level, l > 0 ? (l > 1 ? 1 : l) : 0, dt, 25, 220);
    const m = levelToMeter(level);
    peak = m > peak ? m : Math.max(0, peak - dt * 0.0004);
  };

  const writeColumn = (x: number) => {
    // every column is stored twice (x and x + cols) so the whole ring can be blitted with ONE contiguous drawImage (no seam)
    const stride = cols * 2;
    for (let r = 0; r < rows; r++) {
      const c = ramp[unitToColorIndex(smoothed[r]!)]!;
      const o = (rows - 1 - r) * stride + x;
      px32[o] = c;
      px32[o + cols] = c;
    }
  };

  const putRange = (x: number, count: number) => {
    if (img && offCtx && count > 0) offCtx.putImageData(img, 0, 0, x, 0, count, rows);
  };

  const flushColumns = (from: number, count: number) => {
    if (!img || !offCtx || count <= 0) return;
    if (from + count <= cols) {
      putRange(from, count);
      putRange(from + cols, count);
    } else {
      const first = cols - from;
      putRange(from, first);
      putRange(from + cols, first);
      putRange(0, count - first);
      putRange(cols, count - first);
    }
  };

  const advance = (dt: number, scrolling: boolean): void => {
    if (!scrolling || dt <= 0) return;
    frac += dt / 1000 / secPerCol;
    let n = Math.floor(frac);
    if (n < 1) return;
    frac -= n;
    if (n > cols) n = cols;
    const from = head;
    for (let i = 0; i < n; i++) {
      writeColumn(head);
      head = head + 1 === cols ? 0 : head + 1;
    }
    flushColumns(from, n);
  };

  const drawLabels = () => {
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i < FREQ_TICKS.length; i++) {
      const t = FREQ_TICKS[i]!;
      const y = py + ph * (1 - freqToUnit(t.hz));
      ctx.globalAlpha = t.label ? 0.28 : 0.12;
      ctx.fillStyle = '#c8bfff';
      ctx.fillRect(px, Math.round(y) - 0.5, pw, 1);
      if (t.label) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#b9b0e8';
        ctx.fillText(t.label, px - 6, y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#8f86c0';
    const tickCount = TIME_TICKS;
    for (let i = 0; i <= tickCount; i++) {
      const x = px + (pw * i) / tickCount;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(Math.round(x) - 0.5, py + ph, 1, 3);
      ctx.globalAlpha = 0.8;
      if (i === tickCount) ctx.fillText('now', x - 8, py + ph + 4);
      else ctx.fillText(TIME_LABELS[i]!, i === 0 ? x + 8 : x, py + ph + 4);
    }
    ctx.globalAlpha = 1;
  };

  const drawMeter = () => {
    const mx = px + pw + 4;
    const mw = 5;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(mx, py, mw, ph);
    const m = levelToMeter(level);
    if (m > 0.002 && meterGrad) {
      ctx.fillStyle = meterGrad;
      ctx.fillRect(mx, py + ph * (1 - m), mw, ph * m);
    }
    if (peak > 0.01) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(mx - 1, py + ph * (1 - peak) - 0.5, mw + 2, 1.5);
      ctx.globalAlpha = 1;
    }
  };

  const frame = (now: number, dt: number, playing: boolean): void => {
    if (!img || !off) return;
    const audioReady = useStore.getState().audioReady;
    if (dt > 0) updateRows(dt, playing, now);
    // while paused (audio started but not playing) the history freezes; before audio starts we show a faint idle drift
    advance(dt, playing || !audioReady);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05010f';
    ctx.fillRect(0, 0, W, H);

    // plot: the (doubled) ring buffer is blitted from the oldest column, shifted by the sub-column fraction for smooth scrolling
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    const colPx = pw / cols;
    const shift = -frac * colPx;
    ctx.drawImage(off, head, 0, cols, rows, px + shift, py, cols * colPx, ph);
    ctx.restore();

    ctx.strokeStyle = 'rgba(139, 92, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 0.5, py - 0.5, pw + 1, ph + 1);

    drawLabels();
    drawMeter();
  };

  return { resize, frame };
};

export const SPECTROGRAM_OPTIONS = { fpsActive: 40, fpsIdle: 20 };
