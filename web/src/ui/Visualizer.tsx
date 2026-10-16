import { useEffect, useRef } from 'react';
import { useStore } from '../services/store';
import { getVisualizerSource } from './visualizerSource';
import { buildLogBins, dbToUnit, peakDb, smoothValue } from './visualizerMath';

const BARS = 56;
const FPS_ACTIVE = 45;
const FPS_IDLE = 20;
const STAR_COUNT = 70;
const GRID_LINES_H = 14;
const GRID_LINES_V = 16;

interface Layout {
  w: number;
  h: number;
  dpr: number;
  horizon: number;
  sunR: number;
  skyGrad: CanvasGradient;
  floorGrad: CanvasGradient;
  sunGrad: CanvasGradient;
  glowGrad: CanvasGradient;
}

export function Visualizer() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // ---- preallocated state (no per-frame allocation) ----
    const bars = new Float32Array(BARS);
    const starts = new Uint16Array(BARS);
    const ends = new Uint16Array(BARS);
    const barColors: string[] = [];
    for (let i = 0; i < BARS; i++) {
      const t = i / (BARS - 1);
      // cyan (low) -> violet -> magenta (high)
      const hue = 185 + t * 135;
      barColors.push(`hsl(${hue.toFixed(0)} 100% 60%)`);
    }
    const starX = new Float32Array(STAR_COUNT);
    const starY = new Float32Array(STAR_COUNT);
    const starS = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      starX[i] = Math.random();
      starY[i] = Math.random() * 0.9;
      starS[i] = 0.5 + Math.random() * 1.2;
    }
    let binCount = 0;
    let layout: Layout | null = null;
    let level = 0;
    let scroll = 0;
    let phase = 0;
    let raf = 0;
    let last = 0;
    let lastDraw = 0;
    let running = false;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const horizon = h * 0.6;
      const sunR = Math.min(w * 0.22, h * 0.36);

      const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
      skyGrad.addColorStop(0, '#05010f');
      skyGrad.addColorStop(0.55, '#1a0638');
      skyGrad.addColorStop(1, '#5a0f6e');
      const floorGrad = ctx.createLinearGradient(0, horizon, 0, h);
      floorGrad.addColorStop(0, '#2a0838');
      floorGrad.addColorStop(0.25, '#10052a');
      floorGrad.addColorStop(1, '#05010f');
      // sun gradient is defined around (0,0) so it can be translated/scaled per frame
      const sunGrad = ctx.createLinearGradient(0, -sunR, 0, sunR);
      sunGrad.addColorStop(0, '#ffe14d');
      sunGrad.addColorStop(0.5, '#ff4fa3');
      sunGrad.addColorStop(1, '#b01cff');
      const glowGrad = ctx.createRadialGradient(0, 0, sunR * 0.8, 0, 0, sunR * 2.2);
      glowGrad.addColorStop(0, 'rgba(255, 60, 200, 0.38)');
      glowGrad.addColorStop(1, 'rgba(255, 60, 200, 0)');
      layout = { w, h, dpr, horizon, sunR, skyGrad, floorGrad, sunGrad, glowGrad };
    };

    const updateBars = (dt: number, playing: boolean, now: number) => {
      const src = playing ? getVisualizerSource() : null;
      let spec: Float32Array | null = null;
      if (src) {
        spec = src.getSpectrum();
        if (spec.length < 2) spec = null;
      }
      let targetLevel = 0;
      if (src) {
        const l = src.getLevel();
        targetLevel = l > 0 ? (l > 1 ? 1 : l) : 0;
      }
      if (spec) {
        if (spec.length !== binCount) {
          binCount = spec.length;
          buildLogBins(binCount, BARS, starts, ends);
        }
        for (let i = 0; i < BARS; i++) {
          // gentle high-frequency tilt: music spectra fall off ~ -4.5 dB/oct
          const tilt = 0.08 * (i / BARS);
          const target = Math.min(1, dbToUnit(peakDb(spec, starts[i]!, ends[i]!)) + tilt);
          bars[i] = smoothValue(bars[i]!, target, dt, 35, 240);
        }
      } else {
        // idle: slow, quiet travelling waves
        for (let i = 0; i < BARS; i++) {
          const target = 0.07 + 0.05 * Math.sin(now * 0.0007 + i * 0.35) + 0.03 * Math.sin(now * 0.0011 - i * 0.8);
          bars[i] = smoothValue(bars[i]!, target, dt, 200, 400);
        }
      }
      level = smoothValue(level, targetLevel, dt, 40, 260);
    };

    const draw = (now: number, playing: boolean) => {
      const L = layout;
      if (!L) return;
      const { w, h, horizon, sunR, dpr } = L;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // sky
      ctx.fillStyle = L.skyGrad;
      ctx.fillRect(0, 0, w, horizon);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < STAR_COUNT; i++) {
        ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(now * 0.0008 * starS[i]! + i));
        ctx.fillRect(starX[i]! * w, starY[i]! * horizon, starS[i]!, starS[i]!);
      }
      ctx.globalAlpha = 1;

      // sun (pulses with level), clipped at horizon, with retro stripes
      const pulse = 1 + level * 0.12;
      const sunCx = w / 2;
      const sunCy = horizon - sunR * 0.35;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, horizon);
      ctx.clip();
      ctx.translate(sunCx, sunCy);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = L.glowGrad;
      ctx.globalAlpha = 0.55 + level * 0.45;
      ctx.fillRect(-sunR * 2.3, -sunR * 2.3, sunR * 4.6, sunR * 4.6);
      ctx.globalAlpha = 1;
      // stripe mask: solid top half, then bands that get thicker toward the bottom
      ctx.beginPath();
      ctx.rect(-sunR, -sunR, sunR * 2, sunR);
      let gap = sunR * 0.035;
      const bandH = sunR * 0.11;
      let y = 0;
      while (y < sunR) {
        const bot = Math.min(sunR, y + bandH);
        if (bot > y) ctx.rect(-sunR, y, sunR * 2, bot - y);
        y += bandH + gap;
        gap += sunR * 0.012;
      }
      ctx.clip();
      ctx.beginPath();
      ctx.arc(0, 0, sunR, 0, Math.PI * 2);
      ctx.fillStyle = L.sunGrad;
      ctx.fill();
      ctx.restore();

      // floor
      ctx.fillStyle = L.floorGrad;
      ctx.fillRect(0, horizon, w, h - horizon);

      // perspective grid: horizontal lines scroll toward the viewer
      const floorH = h - horizon;
      ctx.lineWidth = 1.25;
      for (let i = 0; i < GRID_LINES_H; i++) {
        const t = (i + (scroll % 1)) / GRID_LINES_H;
        const yy = horizon + floorH * t * t;
        ctx.globalAlpha = 0.15 + 0.7 * t;
        ctx.strokeStyle = '#ff2bd6';
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
        ctx.stroke();
      }
      // vertical lines converge at the vanishing point (batched into one path, drawn twice for glow)
      const vx = w / 2;
      ctx.beginPath();
      for (let j = -GRID_LINES_V; j <= GRID_LINES_V; j++) {
        ctx.moveTo(vx + j * w * 0.012, horizon);
        ctx.lineTo(vx + j * w * 0.12, h);
      }
      ctx.strokeStyle = '#8b5cff';
      ctx.globalAlpha = 0.18 + level * 0.25;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#c79bff';
      ctx.stroke();
      ctx.globalAlpha = 1;

      // horizon glow line
      ctx.fillStyle = '#ff5ce1';
      ctx.globalAlpha = 0.7 + level * 0.3;
      ctx.fillRect(0, horizon - 1, w, 2);
      ctx.globalAlpha = 1;

      // spectrum bars on the horizon, mirrored (reflection) into the floor
      const gapPx = 2;
      const bw = Math.max(1, (w * 0.86) / BARS - gapPx);
      const x0 = w * 0.07;
      const maxH = horizon * 0.5;
      for (let i = 0; i < BARS; i++) {
        const bh = 2 + bars[i]! * maxH;
        const x = x0 + i * (bw + gapPx);
        ctx.fillStyle = barColors[i]!;
        ctx.globalAlpha = playing ? 0.92 : 0.5;
        ctx.fillRect(x, horizon - bh, bw, bh);
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x, horizon + 2, bw, bh * 0.55);
      }
      ctx.globalAlpha = 1;
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const playing = useStore.getState().playing;
      const interval = 1000 / (playing ? FPS_ACTIVE : FPS_IDLE);
      if (t - lastDraw < interval - 1) return;
      lastDraw = t;
      const dt = last === 0 ? 16 : Math.min(100, t - last);
      last = t;
      if (!reducedMotion) {
        phase += dt;
        scroll += (dt / 1000) * (playing ? 0.55 + level * 1.4 : 0.12);
        if (scroll > 1e6) scroll = 0;
      }
      updateBars(dt, playing, phase);
      draw(phase, playing);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(phase, useStore.getState().playing); // repaint after resize even if paused
    });
    ro.observe(wrap);
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="visualizer" ref={wrapRef}>
      <canvas ref={canvasRef} className="visualizer__canvas" role="img" aria-label="Audio reactive synthwave visualizer" />
      <div className="visualizer__title" aria-hidden="true">
        GHOST<span> FREQUENCY</span>
      </div>
    </div>
  );
}
