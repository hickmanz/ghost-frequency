import type { KeySpec, LayerId, MusicEvent } from '@shared/index';
import { useStore } from '../../services/store';
import { getFeedSource, type FeedSection } from '../feedSource';
import type { SceneFactory, SceneInstance } from './canvasScene';
import { clamp, clamp01 } from './common';
import {
  BEATS_PER_BAR,
  LANE_ORDER,
  PLAYHEAD_FRAC,
  barLabelStride,
  beatToX,
  drumRow,
  energyAtBeat,
  findSectionIndex,
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
} from './timelineMath';

const LANE_COUNT = LANE_ORDER.length;
const MAX_BARS = 160;
const GAIN_CAP = 96;
const GAIN_REBUILD_MS = 500;
const GAIN_HISTORY_BEATS = 256;
const ENERGY_STEP_PX = 3;
const RULER_H = 14;
const FONT = '10px ui-monospace, Consolas, monospace';
const FONT_BOLD = '700 10px system-ui, Segoe UI, sans-serif';
const FONT_SMALL = '9px ui-monospace, Consolas, monospace';

const LAYER_COLOR: Record<LayerId, string> = {
  lead: '#ffb13d',
  arp: '#19e6ff',
  pad: '#8b5cff',
  texture: '#3dffb0',
  bass: '#ff2bd6',
  drums: '#ece8ff',
  bell: '#ffd27a',
};
const LAYER_LABEL: Record<LayerId, string> = {
  lead: 'LEAD',
  arp: 'ARP',
  pad: 'PAD',
  texture: 'TEX',
  bass: 'BASS',
  drums: 'DRUMS',
  bell: 'BELL',
};
/** drum rows top -> bottom: crash/tom, hats, snare/clap, kick */
const DRUM_ROW_COLOR = ['#ffb13d', '#19e6ff', '#ece8ff', '#ff2bd6'] as const;

const GAIN_LANE: Record<string, number> = {};
for (const l of LANE_ORDER) GAIN_LANE[`layer.gain.${l}`] = laneIndex(l);

interface SectionStyle {
  solid: string;
  text: string;
}

export const createTimelineScene: SceneFactory = (ctx): SceneInstance => {
  // ---- layout (CSS px) ----
  let W = 1;
  let H = 1;
  let dpr = 1;
  let playheadX = 1;
  let pxPerBeat = 1;
  let pastBars = 48;
  let sectTop = 0;
  let sectH = 24;
  let energyTop = 0;
  let energyH = 40;
  let chordTop = 0;
  let lanesTop = 0;
  let laneH = 20;
  let energyGrad: CanvasGradient | null = null;
  const CHORD_H = 12;

  // ---- per frame scratch (preallocated) ----
  const density = new Float32Array(MAX_BARS + 4);
  let densCount = 0;
  let densFirstBar = 0;
  let densNorm = 1;
  const gainBeats: Float64Array[] = [];
  const gainVals: Float32Array[] = [];
  const gainRamps: Float32Array[] = [];
  const gainCount = new Int32Array(LANE_COUNT);
  for (let i = 0; i < LANE_COUNT; i++) {
    gainBeats.push(new Float64Array(GAIN_CAP));
    gainVals.push(new Float32Array(GAIN_CAP));
    gainRamps.push(new Float32Array(GAIN_CAP));
  }
  let lastGainBuild = -1e9;
  let knownEnd = 0;
  let curNowBeat = 0;
  let curStyle = '';
  let lastLabelX = -1e9;
  const sectionStyles = new Map<string, SectionStyle>();
  const keyLabels = new WeakMap<KeySpec, string>();
  const barLabels = new Map<number, string>();
  const laneTop: number[] = new Array<number>(LANE_COUNT).fill(0);

  const setFill = (style: string) => {
    if (style !== curStyle) {
      ctx.fillStyle = style;
      curStyle = style;
    }
  };

  const sectionStyle = (name: string): SectionStyle => {
    let s = sectionStyles.get(name);
    if (!s) {
      const c = sectionColor(name);
      s = {
        solid: `hsl(${c.h} ${c.s}% ${c.l}%)`,
        text: `hsl(${c.h} ${Math.min(100, c.s + 6)}% ${Math.min(92, c.l + 26)}%)`,
      };
      sectionStyles.set(name, s);
    }
    return s;
  };

  const keyLabelOf = (key: KeySpec): string => {
    let s = keyLabels.get(key);
    if (!s) {
      s = keyShortLabel(key);
      keyLabels.set(key, s);
    }
    return s;
  };

  const barLabel = (n: number): string => {
    let s = barLabels.get(n);
    if (!s) {
      if (barLabels.size > 1500) barLabels.clear();
      s = String(n);
      barLabels.set(n, s);
    }
    return s;
  };

  const resize = (w: number, h: number, ratio: number) => {
    W = w;
    H = h;
    dpr = ratio;
    playheadX = Math.round(w * PLAYHEAD_FRAC);
    pastBars = pastBarsFor(w);
    pxPerBeat = pxPerBeatFor(w, pastBars);
    sectTop = RULER_H + 2;
    sectH = clamp(Math.round(h * 0.1), 22, 32);
    energyTop = sectTop + sectH + 4;
    energyH = clamp(Math.round(h * 0.18), 32, 64);
    chordTop = energyTop + energyH + 2;
    lanesTop = chordTop + CHORD_H;
    laneH = Math.max(8, (h - lanesTop - 4) / LANE_COUNT);
    for (let i = 0; i < LANE_COUNT; i++) laneTop[i] = lanesTop + i * laneH;
    const g = ctx.createLinearGradient(0, energyTop, 0, energyTop + energyH);
    g.addColorStop(0, 'rgba(255, 43, 214, 0.32)');
    g.addColorStop(1, 'rgba(255, 43, 214, 0)');
    energyGrad = g;
  };

  // ---- gain automation tracking (rebuilt a couple times per second) ----
  const onGainEvent = (e: MusicEvent) => {
    if (e.kind !== 'automation') return;
    const lane = GAIN_LANE[e.target];
    if (lane === undefined) return;
    gainCount[lane] = insertBreakpoint(
      gainBeats[lane]!,
      gainVals[lane]!,
      gainRamps[lane]!,
      gainCount[lane]!,
      e.beat,
      e.value,
      e.rampBeats ?? 0,
    );
  };

  // ---- note drawing (one pass over the visible window per frame) ----
  let maxBeatSeen = 0;
  const onDrawEvent = (e: MusicEvent) => {
    const eb = e.beat;
    if (eb > maxBeatSeen) maxBeatSeen = eb;
    if (e.kind === 'note') {
      const di = Math.floor(eb / BEATS_PER_BAR) - densFirstBar;
      if (di >= 0 && di < MAX_BARS) {
        density[di] = density[di]! + (e.layer === 'drums' ? 0.35 : 0.5 + e.vel);
        if (di + 1 > densCount) densCount = di + 1;
      }
      const lane = laneIndex(e.layer);
      const x = beatToX(eb, curNowBeat, playheadX, pxPerBeat);
      const future = eb > curNowBeat;
      const top = laneTop[lane]!;
      if (e.layer === 'drums') {
        const row = drumRow(e.midi);
        const rh = (laneH - 2) / 4;
        setFill(DRUM_ROW_COLOR[row]!);
        ctx.globalAlpha = (0.35 + 0.65 * e.vel) * (future ? 0.6 : 1);
        ctx.fillRect(x, top + 1 + row * rh, 1.4, Math.max(1.5, rh - 0.5));
        return;
      }
      const dur = e.durBeats * pxPerBeat;
      const nh = Math.max(2, laneH / 9);
      const y = top + 1 + (1 - notePitchFrac(e.layer, e.midi)) * (laneH - 2 - nh);
      const active = !future && eb + e.durBeats > curNowBeat;
      setFill(active ? '#ffffff' : LAYER_COLOR[e.layer]);
      ctx.globalAlpha = active ? 1 : (0.3 + 0.7 * e.vel) * (future ? 0.6 : 1);
      ctx.fillRect(x, y, dur < 1.2 ? 1.2 : dur, nh);
    } else if (e.kind === 'section' && e.chord) {
      const x = beatToX(eb, curNowBeat, playheadX, pxPerBeat);
      setFill('#ff5ce1');
      ctx.globalAlpha = 0.28;
      ctx.fillRect(x, chordTop, 1, H - chordTop - 2);
      if (x > 2 && x - lastLabelX > 30) {
        lastLabelX = x;
        ctx.globalAlpha = 0.9;
        setFill('#ffd1f5');
        ctx.fillText(e.chord.label, x + 3, chordTop + 1);
      }
    }
  };

  const drawGrid = (from: number, to: number) => {
    const b0 = Math.floor(from / BEATS_PER_BAR);
    const b1 = Math.ceil(to / BEATS_PER_BAR);
    const barPx = pxPerBeat * BEATS_PER_BAR;
    const stride = barLabelStride(barPx, 34);
    const bottom = H - 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#8b5cff';
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    for (let b = b0; b <= b1; b++) {
      if (b % 4 === 0) continue;
      const x = Math.round(beatToX(b * BEATS_PER_BAR, curNowBeat, playheadX, pxPerBeat)) + 0.5;
      ctx.moveTo(x, sectTop);
      ctx.lineTo(x, bottom);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.26;
    ctx.beginPath();
    for (let b = b0; b <= b1; b++) {
      if (b % 4 !== 0) continue;
      const x = Math.round(beatToX(b * BEATS_PER_BAR, curNowBeat, playheadX, pxPerBeat)) + 0.5;
      ctx.moveTo(x, RULER_H - 3);
      ctx.lineTo(x, bottom);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#b9b0e8';
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let b = b0; b <= b1; b++) {
      if (b < 0 || b % stride !== 0) continue;
      const x = beatToX(b * BEATS_PER_BAR, curNowBeat, playheadX, pxPerBeat);
      if (x < -20 || x > W) continue;
      ctx.fillText(barLabel(b + 1), x + 3, 1);
    }
    ctx.globalAlpha = 1;
  };

  const drawLaneBackgrounds = (muted: Partial<Record<LayerId, boolean>>, solo: LayerId | null) => {
    ctx.font = FONT_SMALL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < LANE_COUNT; i++) {
      const layer = LANE_ORDER[i]!;
      if (i % 2 === 0) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(0, laneTop[i]!, W, laneH);
      }
      const silenced = muted[layer] === true || (solo !== null && solo !== layer);
      ctx.globalAlpha = silenced ? 0.25 : 0.6;
      ctx.fillStyle = LAYER_COLOR[layer];
      ctx.fillText(LAYER_LABEL[layer], 4, laneTop[i]! + laneH / 2);
    }
    ctx.globalAlpha = 1;
  };

  const drawLaneOverlays = (from: number, to: number, muted: Partial<Record<LayerId, boolean>>, solo: LayerId | null) => {
    ctx.fillStyle = 'rgba(5, 1, 15, 0.68)';
    ctx.globalAlpha = 1;
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const layer = LANE_ORDER[lane]!;
      if (muted[layer] === true || (solo !== null && solo !== layer)) {
        ctx.fillRect(0, laneTop[lane]!, W, laneH);
        continue;
      }
      const n = gainCount[lane]!;
      if (n === 0) continue;
      const bs = gainBeats[lane]!;
      const vs = gainVals[lane]!;
      const rs = gainRamps[lane]!;
      for (let k = 0; k < n; k++) {
        if (vs[k]! >= 0.08) continue;
        const s = bs[k]! + rs[k]! * 0.5;
        const e = k + 1 < n ? bs[k + 1]! + rs[k + 1]! * 0.5 : to + 1000;
        if (e < from || s > to) continue;
        const x0 = Math.max(0, beatToX(s, curNowBeat, playheadX, pxPerBeat));
        const x1 = Math.min(W, beatToX(e, curNowBeat, playheadX, pxPerBeat));
        if (x1 > x0) ctx.fillRect(x0, laneTop[lane]!, x1 - x0, laneH);
      }
    }
  };

  const drawSections = (secs: readonly FeedSection[], from: number, to: number) => {
    if (secs.length === 0) return;
    const curIdx = findSectionIndex(secs, curNowBeat);
    let i = Math.max(0, findSectionIndex(secs, from));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (; i < secs.length; i++) {
      const sec = secs[i]!;
      if (sec.startBeat > to) break;
      const end = sec.endBeat < knownEnd ? sec.endBeat : knownEnd;
      if (end <= sec.startBeat) continue;
      const x0 = Math.max(-2, beatToX(sec.startBeat, curNowBeat, playheadX, pxPerBeat));
      const x1 = Math.min(W + 2, beatToX(end, curNowBeat, playheadX, pxPerBeat));
      const w = x1 - x0;
      if (w < 1) continue;
      const st = sectionStyle(sec.name);
      const isCur = i === curIdx;
      ctx.fillStyle = st.solid;
      ctx.globalAlpha = 0.12 + 0.3 * sec.energy + (isCur ? 0.2 : 0);
      ctx.fillRect(x0 + 0.5, sectTop, w - 1, sectH);
      ctx.globalAlpha = isCur ? 1 : 0.8;
      ctx.fillRect(x0 + 0.5, sectTop, w - 1, 3);
      if (isCur) {
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 1, sectTop + 0.5, Math.max(1, w - 2), sectH - 1);
      }
      const tx = Math.max(x0, 0) + 6;
      if (x1 - tx > 34) {
        ctx.globalAlpha = isCur ? 1 : 0.85;
        ctx.fillStyle = isCur ? '#ffffff' : st.text;
        ctx.font = FONT_BOLD;
        ctx.fillText(sec.name, tx, sectTop + 6);
        if (x1 - tx > 96 && sectH >= 26) {
          ctx.font = FONT_SMALL;
          ctx.globalAlpha = isCur ? 0.95 : 0.6;
          ctx.fillText(keyLabelOf(sec.key), tx, sectTop + 18);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  const drawEnergy = (
    secs: readonly FeedSection[],
    fallbackEnergy: number,
  ) => {
    const base = energyTop + energyH;
    const amp = energyH - 6;
    const xFirst = secs.length ? Math.max(0, beatToX(secs[0]!.startBeat, curNowBeat, playheadX, pxPerBeat)) : 0;
    const xEnd = Math.min(W, beatToX(knownEnd, curNowBeat, playheadX, pxPerBeat));
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, base, W, 1);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#8f86c0';
    ctx.font = FONT_SMALL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('ENERGY', 4, energyTop + 1);
    ctx.globalAlpha = 1;
    if (xEnd - xFirst < 2) return;
    ctx.beginPath();
    let x = xFirst;
    let first = true;
    for (; x < xEnd; x += ENERGY_STEP_PX) {
      const beat = xToBeat(x, curNowBeat, playheadX, pxPerBeat);
      const e = clamp01(
        0.65 * energyAtBeat(secs, beat, 4, fallbackEnergy) + 0.35 * clamp01(sampleBarValues(density, densCount, densFirstBar, beat) / densNorm),
      );
      const y = base - 2 - e * amp;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ff2bd6';
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffd1f5';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(x, base);
    ctx.lineTo(xFirst, base);
    ctx.closePath();
    if (energyGrad) {
      ctx.fillStyle = energyGrad;
      ctx.fill();
    }
    // marker at the playhead
    if (playheadX >= xFirst && playheadX <= xEnd) {
      const e = clamp01(
        0.65 * energyAtBeat(secs, curNowBeat, 4, fallbackEnergy) +
          0.35 * clamp01(sampleBarValues(density, densCount, densFirstBar, curNowBeat) / densNorm),
      );
      const y = base - 2 - e * amp;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(playheadX, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawPlayhead = () => {
    ctx.strokeStyle = '#ff5ce1';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, sectTop - 2);
    ctx.lineTo(playheadX + 0.5, H);
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(playheadX - 5, 1);
    ctx.lineTo(playheadX + 6, 1);
    ctx.lineTo(playheadX + 0.5, 9);
    ctx.closePath();
    ctx.fill();
  };

  const frame = (now: number, _dt: number, playing: boolean): void => {
    const feed = getFeedSource();
    const st = useStore.getState();
    const secs = feed ? feed.getSections() : null;
    const hasData = !!feed && !!secs && secs.length > 0;
    // real audio position when we have data; otherwise a slow idle drift so the view is alive before playback
    curNowBeat = hasData && feed ? Math.max(0, feed.getBeat()) : now * 0.0009;
    if (!playing && !hasData) curNowBeat = now * 0.0009;
    const { from, to } = visibleBeatRange(curNowBeat, W, playheadX, pxPerBeat);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#05010f';
    ctx.fillRect(0, 0, W, H);
    curStyle = '';

    // upcoming (right of playhead) gets a faint tint
    ctx.fillStyle = 'rgba(139, 92, 255, 0.04)';
    ctx.fillRect(playheadX, sectTop, W - playheadX, H - sectTop);

    drawLaneBackgrounds(st.muted, st.solo);
    drawGrid(from, to);

    if (!hasData || !feed || !secs) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now * 0.002);
      ctx.fillStyle = '#c8bfff';
      ctx.font = FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        feed && st.audioReady ? 'Press play - the song structure will unfold here' : 'The song structure appears here once playback starts',
        (playheadX * 0.5 + W * 0.5) | 0,
        (lanesTop + H) / 2,
      );
      ctx.globalAlpha = 1;
      drawPlayhead();
      return;
    }

    // gain automation breakpoints (periodic rebuild; cheap enough to rescan a bounded history)
    if (now - lastGainBuild > GAIN_REBUILD_MS || now < lastGainBuild) {
      lastGainBuild = now;
      gainCount.fill(0);
      feed.forEachEvent(Math.max(0, from - GAIN_HISTORY_BEATS), to + 16, onGainEvent);
    }

    // notes / drums / chord markers
    densFirstBar = Math.floor(from / BEATS_PER_BAR);
    densCount = 0;
    const barSpan = Math.min(MAX_BARS, Math.ceil(to / BEATS_PER_BAR) - densFirstBar + 1);
    for (let i = 0; i < barSpan; i++) density[i] = 0;
    maxBeatSeen = curNowBeat;
    lastLabelX = -1e9;
    ctx.font = FONT_SMALL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    curStyle = '';
    feed.forEachEvent(from, to, onDrawEvent);
    ctx.globalAlpha = 1;
    // `knownEnd`: how far generated music reaches (end of the lookahead)
    knownEnd = Math.max(maxBeatSeen, curNowBeat) + 0.5;
    densCount = Math.max(densCount, barSpan);
    let dmax = 0;
    for (let i = 0; i < densCount; i++) if (density[i]! > dmax) dmax = density[i]!;
    densNorm = Math.max(6, dmax);

    drawLaneOverlays(from, to, st.muted, st.solo);

    // beyond the generated lookahead: darken
    const xEnd = beatToX(knownEnd, curNowBeat, playheadX, pxPerBeat);
    if (xEnd < W) {
      ctx.fillStyle = 'rgba(5, 1, 15, 0.5)';
      ctx.fillRect(Math.max(0, xEnd), sectTop, W - Math.max(0, xEnd), H - sectTop);
    }

    drawSections(secs, from, to);
    drawEnergy(secs, st.params.energy);
    drawPlayhead();
  };

  return { resize, frame };
};

export const TIMELINE_OPTIONS = { fpsActive: 40, fpsIdle: 20 };
