import type { MoodId, MusicEvent } from '@shared/index';
import { useStore } from '../../services/store';
import { getFeedSource } from '../feedSource';
import { getVisualizerSource } from '../visualizerSource';
import { smoothValue } from '../visualizerMath';
import type { SceneFactory, SceneInstance } from './canvasScene';
import { clamp01, fillRidgeTable, hash01, sampleTable } from './common';
import {
  BUILDING_COUNT,
  PARTICLE_CAP,
  PARTICLE_PALETTE,
  ParticlePool,
  RIDGE_CELLS,
  RIDGE_TABLE_SIZE,
  THEMES,
  THEME_ORDER,
  buildSkyline,
  buildStars,
  crossfadeWeight,
  decayImpulse,
  drumKind,
  paletteIndex,
  pitchCold,
  pitchSkyFrac,
  ridgeTablePos,
  scrollSpeed,
  starIndexForPitch,
  stepCrossfade,
  themeFor,
  type Crossfade,
  type Skyline,
  type Theme,
} from './landscapeMath';
import { findSectionIndex } from './timelineMath';

const STAR_TOTAL = 160;
const GRID_H = 14;
const GRID_V = 16;
const RAIN_COUNT = 90;
const RIPPLE_COUNT = 6;
const PARALLAX = [0.22, 0.5, 1] as const;
const KICK_RIPPLE_MS = 1100;
const BASS_RIPPLE_MS = 1700;
const WIPE_MS = 1800;
const MAX_BEAT_GAP = 3; // beats; larger jumps (seek, tab wake-up) are not replayed as events

interface ThemeGfx {
  sky: CanvasGradient;
  ground: CanvasGradient;
  sunGlow: CanvasGradient;
  sunDisc: CanvasGradient;
  horizonGlow: CanvasGradient;
  fog: CanvasGradient;
  nebula: CanvasGradient[];
}

function withAlpha(rgba: string, a: number): string {
  return rgba.replace(/[\d.]+\)\s*$/, `${a})`);
}

export const createLandscapeScene: SceneFactory = (ctx): SceneInstance => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const motion = reduced ? 0 : 1;

  // ---- geometry / caches (rebuilt on resize) ----
  let W = 1;
  let H = 1;
  let dpr = 1;
  let horizon = 1;
  let floorH = 1;
  let sunR = 1;
  let fogH = 1;
  let ridgeStep = 4;
  const gfx = {} as Record<MoodId, ThemeGfx>;
  let wipeGrad: CanvasGradient | null = null;
  let wipeW = 1;

  // ---- seed-dependent procedural data ----
  let builtSeed = -1;
  let skylineDirty = true;
  const smoothTab: Float32Array[] = [];
  const ridgedTab: Float32Array[] = [];
  for (let l = 0; l < 3; l++) {
    smoothTab.push(new Float32Array(RIDGE_TABLE_SIZE));
    ridgedTab.push(new Float32Array(RIDGE_TABLE_SIZE));
  }
  let skyline: Skyline = buildSkyline(1, 640);
  const starX = new Float32Array(STAR_TOTAL);
  const starY = new Float32Array(STAR_TOTAL);
  const starS = new Float32Array(STAR_TOTAL);
  const starRank = new Float32Array(STAR_TOTAL);
  for (let i = 0; i < STAR_TOTAL; i++) starRank[i] = hash01(i, 77);
  const starBoost = new Float32Array(STAR_TOTAL);
  const starCol = new Uint8Array(STAR_TOTAL);

  // ---- dynamic state ----
  const pool = new ParticlePool(PARTICLE_CAP);
  const rainX = new Float32Array(RAIN_COUNT);
  const rainY = new Float32Array(RAIN_COUNT);
  const rainV = new Float32Array(RAIN_COUNT);
  const rainL = new Float32Array(RAIN_COUNT);
  const rAge = new Float32Array(RIPPLE_COUNT);
  const rDur = new Float32Array(RIPPLE_COUNT);
  const rStr = new Float32Array(RIPPLE_COUNT);
  const rKind = new Uint8Array(RIPPLE_COUNT);
  let rNext = 0;

  const initialMood = useStore.getState().params.mood;
  const cf: Crossfade = { from: initialMood, to: initialMood, t: 1 };
  let level = 0;
  let kick = 0;
  let gridFlash = 0;
  let flash = 0;
  let bassShake = 0;
  let padPulse = 0;
  let wipe = 0;
  let energySm = 0.5;
  let secEnergy = -1;
  let lastSectionIndex = -1;
  let ridgePx = 0;
  let gridScroll = 0;
  let lastBeat = -1;
  let idleTimer = 600;
  let particleCounter = 0;
  let nowMs = 0;

  const rebuildSeed = (seed: number) => {
    builtSeed = seed;
    for (let l = 0; l < 3; l++) {
      fillRidgeTable(smoothTab[l]!, seed + l * 31, RIDGE_CELLS, false);
      fillRidgeTable(ridgedTab[l]!, seed + l * 31 + 7, RIDGE_CELLS, true);
    }
    buildStars(seed, STAR_TOTAL, starX, starY, starS);
  };

  const resetRain = () => {
    for (let i = 0; i < RAIN_COUNT; i++) {
      rainX[i] = Math.random() * W;
      rainY[i] = Math.random() * H;
      rainV[i] = 0.55 + Math.random() * 0.5;
      rainL[i] = 8 + Math.random() * 14;
    }
  };

  const resize = (w: number, h: number, ratio: number) => {
    W = w;
    H = h;
    dpr = ratio;
    horizon = h * 0.6;
    floorH = h - horizon;
    sunR = Math.min(w * 0.22, h * 0.36);
    fogH = horizon * 0.4;
    ridgeStep = Math.max(3, w / 220);
    for (const id of THEME_ORDER) {
      const t = THEMES[id];
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      for (const [p, c] of t.sky) sky.addColorStop(p, c);
      const ground = ctx.createLinearGradient(0, horizon, 0, h);
      for (const [p, c] of t.ground) ground.addColorStop(p, c);
      const r = sunR * t.sun.radius;
      const sunDisc =
        t.sun.kind === 'planet' ? ctx.createLinearGradient(-r, -r * 0.8, r * 0.8, r) : ctx.createLinearGradient(0, -r, 0, r);
      for (const [p, c] of t.sun.stops) sunDisc.addColorStop(p, c);
      const sunGlow = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 2.4);
      sunGlow.addColorStop(0, t.sun.glow);
      sunGlow.addColorStop(1, withAlpha(t.sun.glow, 0));
      const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.65);
      hg.addColorStop(0, t.horizonGlow);
      hg.addColorStop(1, withAlpha(t.horizonGlow, 0));
      const fog = ctx.createLinearGradient(0, horizon - fogH, 0, horizon + fogH * 0.5);
      fog.addColorStop(0, withAlpha(t.fogColor, 0));
      fog.addColorStop(0.65, withAlpha(t.fogColor, 0.5));
      fog.addColorStop(1, withAlpha(t.fogColor, 0));
      const nebula: CanvasGradient[] = [];
      for (const b of t.nebula) {
        const g = ctx.createRadialGradient(b.x * w, b.y * horizon, 0, b.x * w, b.y * horizon, b.r * w);
        g.addColorStop(0, b.color);
        g.addColorStop(1, withAlpha(b.color, 0));
        nebula.push(g);
      }
      gfx[id] = { sky, ground, sunGlow, sunDisc, horizonGlow: hg, fog, nebula };
    }
    wipeW = w * 0.45;
    const wg = ctx.createLinearGradient(0, 0, wipeW, 0);
    wg.addColorStop(0, 'rgba(255,255,255,0)');
    wg.addColorStop(0.5, 'rgba(255,230,255,0.34)');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    wipeGrad = wg;
    skylineDirty = true; // width-dependent skyline tile is rebuilt next frame
    resetRain();
    pool.clear();
  };

  // ---------------------------------------------------------------------------------------------
  // reactions to musical events
  // ---------------------------------------------------------------------------------------------
  const spawnRipple = (kind: number, strength: number) => {
    const i = rNext;
    rNext = (rNext + 1) % RIPPLE_COUNT;
    rAge[i] = 0;
    rDur[i] = kind === 0 ? KICK_RIPPLE_MS : BASS_RIPPLE_MS;
    rStr[i] = clamp01(strength);
    rKind[i] = kind;
  };

  const spawnSparkles = (n: number, spread: number) => {
    for (let k = 0; k < n; k++) {
      const x = Math.random() * W;
      const y = horizon * (0.12 + 0.8 * Math.random() * spread);
      pool.spawn(1, x, y, (Math.random() - 0.5) * 0.02, -0.004 - Math.random() * 0.01, 260 + Math.random() * 260, 1.2 + Math.random() * 1.3, 10);
    }
  };

  const onEvent = (e: MusicEvent) => {
    if (e.kind !== 'note' || e.vel < 0.04) return;
    switch (e.layer) {
      case 'drums':
        switch (drumKind(e.midi)) {
          case 'kick':
            kick = Math.min(1, kick + 0.55 + 0.45 * e.vel);
            gridFlash = Math.min(1, gridFlash + 0.5 + 0.5 * e.vel);
            spawnRipple(0, 0.5 + 0.5 * e.vel);
            break;
          case 'snare':
            flash = Math.min(1, flash + 0.45 + 0.55 * e.vel);
            break;
          case 'hat':
            spawnSparkles(e.midi === 46 ? 3 : 1, 1);
            break;
          case 'crash':
            flash = 1;
            spawnSparkles(12, 0.6);
            break;
          case 'tom':
            kick = Math.min(1, kick + 0.3);
            break;
          default:
            break;
        }
        break;
      case 'bass':
        bassShake = Math.min(1, bassShake + 0.35 + 0.5 * e.vel);
        spawnRipple(1, 0.45 + 0.4 * e.vel);
        break;
      case 'pad':
        padPulse = Math.min(1, padPulse + 0.18 + 0.25 * e.vel);
        break;
      case 'arp':
      case 'lead': {
        const si = starIndexForPitch(e.midi, STAR_TOTAL, particleCounter);
        starBoost[si] = 1;
        starCol[si] = paletteIndex(e.midi);
        if (e.layer === 'lead' || e.vel > 0.6) {
          particleCounter = (particleCounter + 1) | 0;
          const cold = pitchCold(e.midi);
          const x = (0.06 + 0.88 * hash01(e.midi * 131 + particleCounter, 7)) * W;
          const y = pitchSkyFrac(e.midi) * horizon * 0.92;
          pool.spawn(
            0,
            x,
            y,
            (Math.random() - 0.5) * 0.012,
            -0.01 - 0.012 * cold,
            1300 + Math.random() * 900,
            (e.layer === 'lead' ? 2.2 : 1.5) + e.vel * 1.3,
            paletteIndex(e.midi),
          );
        }
        break;
      }
      default:
        break;
    }
  };

  // ---------------------------------------------------------------------------------------------
  // drawing
  // ---------------------------------------------------------------------------------------------
  const drawSun = (t: Theme, g: ThemeGfx, alpha: number, glowAmt: number) => {
    const s = t.sun;
    const r = sunR * s.radius;
    const cx = W * s.x;
    const cy = horizon - horizon * s.y;
    const pulse = 1 + kick * 0.1 + level * 0.05 + 0.015 * Math.sin(nowMs * 0.0009);
    ctx.save();
    if (s.kind !== 'planet') {
      ctx.beginPath();
      ctx.rect(0, 0, W, horizon);
      ctx.clip();
    }
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = alpha * clamp01(0.4 + glowAmt * 0.7);
    ctx.fillStyle = g.sunGlow;
    ctx.fillRect(-r * 2.5, -r * 2.5, r * 5, r * 5);
    ctx.globalAlpha = alpha;
    if (s.kind === 'stripes') {
      ctx.beginPath();
      ctx.rect(-r, -r, r * 2, r);
      let gap = r * 0.035;
      const bandH = r * 0.11;
      let y = 0;
      while (y < r) {
        const bot = Math.min(r, y + bandH);
        if (bot > y) ctx.rect(-r, y, r * 2, bot - y);
        y += bandH + gap;
        gap += r * 0.012;
      }
      ctx.clip();
    }
    if (s.kind === 'planet' && s.ring) {
      ctx.lineWidth = Math.max(1.5, r * 0.11);
      ctx.strokeStyle = s.ring;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.95, r * 0.5, -0.38, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g.sunDisc;
    ctx.fill();
    if (s.kind === 'planet' && s.ring) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.95, r * 0.5, -0.38, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawCity = (t: Theme, alpha: number) => {
    if (t.city <= 0) return;
    const maxH = horizon * 0.3 * t.city;
    const tile = skyline.tileW;
    const off = ridgePx * 0.72;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = t.cityColor;
    for (let i = 0; i < BUILDING_COUNT; i++) {
      let xx = (((skyline.x[i]! - off) % tile) + tile) % tile;
      if (xx > W + 4) xx -= tile;
      const bw = skyline.w[i]!;
      if (xx + bw < 0 || xx > W) continue;
      const bh = skyline.h[i]! * maxH;
      ctx.fillRect(xx, horizon - bh, bw, bh + 2);
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = t.windowColors[pass]!;
      ctx.globalAlpha = alpha * (0.55 + 0.25 * Math.sin(nowMs * 0.0013 + pass * 2));
      for (let i = pass; i < BUILDING_COUNT; i += 2) {
        let xx = (((skyline.x[i]! - off) % tile) + tile) % tile;
        if (xx > W + 4) xx -= tile;
        const bw = skyline.w[i]!;
        if (xx + bw < 0 || xx > W || bw < 9) continue;
        const bh = skyline.h[i]! * maxH;
        if (bh < 14) continue;
        for (let j = 0; j < 3; j++) {
          if (hash01(i, j + 11) < 0.35) continue;
          ctx.fillRect(xx + 3 + hash01(i, j) * (bw - 8), horizon - bh + 4 + hash01(j, i + 5) * (bh - 10), 2, 2);
        }
      }
    }
    ctx.globalAlpha = alpha;
  };

  const drawRidges = (t: Theme, alpha: number, glowAmt: number) => {
    const rs = t.ridges;
    const tabs = rs.ridged ? ridgedTab : smoothTab;
    for (let l = 0; l < 3; l++) {
      if (l === 2) drawCity(t, alpha);
      const amp = rs.heights[l]! * horizon;
      const tab = tabs[l]!;
      const off = ridgePx * PARALLAX[l]!;
      const shake = (l === 2 ? 1 : 0.4) * bassShake * Math.sin(nowMs * 0.045 + l) * 3;
      ctx.beginPath();
      let first = true;
      for (let x = -ridgeStep; x <= W + ridgeStep * 2; x += ridgeStep) {
        const v = sampleTable(tab, ridgeTablePos(off + x, W, l));
        const y = horizon - amp * (0.12 + 0.88 * v) + shake;
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
      }
      if (rs.rim && l < 2) {
        ctx.strokeStyle = rs.rim;
        ctx.globalAlpha = alpha * (0.25 + 0.5 * glowAmt) * (l === 0 ? 0.7 : 1);
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
      ctx.lineTo(W + ridgeStep * 2, horizon + 2);
      ctx.lineTo(-ridgeStep, horizon + 2);
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = rs.colors[l]!;
      ctx.fill();
    }
  };

  const drawGround = (t: Theme, g: ThemeGfx, alpha: number, glowAmt: number) => {
    const amt = t.gridAmount * (1 + gridFlash * 0.7);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g.ground;
    ctx.fillRect(0, horizon, W, floorH);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = t.gridH;
    const sc = gridScroll % 1;
    for (let i = 0; i < GRID_H; i++) {
      const tt = (i + sc) / GRID_H;
      ctx.globalAlpha = alpha * clamp01((0.12 + 0.7 * tt) * amt);
      const yy = horizon + floorH * tt * tt;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
    const vx = W / 2;
    ctx.beginPath();
    for (let j = -GRID_V; j <= GRID_V; j++) {
      ctx.moveTo(vx + j * W * 0.012, horizon);
      ctx.lineTo(vx + j * W * 0.12, H);
    }
    ctx.strokeStyle = t.gridV;
    ctx.globalAlpha = alpha * clamp01((0.16 + level * 0.25 + gridFlash * 0.3) * amt);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = alpha * clamp01(0.7 * amt);
    ctx.lineWidth = 1;
    ctx.stroke();
    // horizon line
    ctx.fillStyle = t.gridH;
    ctx.globalAlpha = alpha * clamp01((0.35 + glowAmt * 0.6) * Math.max(0.35, t.gridAmount));
    ctx.fillRect(0, horizon - 1, W, 2);
    ctx.globalAlpha = alpha;
  };

  const drawTheme = (t: Theme, alpha: number, glowAmt: number) => {
    const g = gfx[t.id];
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g.sky;
    ctx.fillRect(0, 0, W, horizon);
    for (let i = 0; i < g.nebula.length; i++) {
      ctx.fillStyle = g.nebula[i]!;
      ctx.fillRect(0, 0, W, horizon);
    }
    // base stars: a theme shows a deterministic subset of the field
    const frac = t.starCount / STAR_TOTAL;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < STAR_TOTAL; i++) {
      if (starRank[i]! >= frac) continue;
      ctx.globalAlpha = alpha * t.starAlpha * (0.28 + 0.4 * Math.abs(Math.sin(nowMs * 0.0007 * (0.5 + starS[i]!) + i)));
      ctx.fillRect(starX[i]! * W, starY[i]! * horizon * 0.96, starS[i]!, starS[i]!);
    }
    ctx.globalAlpha = alpha;
    // soft horizon glow (energy / level / kick driven), flattened into an ellipse
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, horizon + 1);
    ctx.clip();
    ctx.translate(W * 0.5, horizon);
    ctx.scale(1, 0.55);
    ctx.globalAlpha = alpha * clamp01(0.35 + glowAmt * 0.8);
    ctx.fillStyle = g.horizonGlow;
    ctx.fillRect(-W * 0.65, -W * 0.65, W * 1.3, W * 0.65);
    ctx.restore();
    drawSun(t, g, alpha, glowAmt);
    drawRidges(t, alpha, glowAmt);
    if (t.fog > 0) {
      ctx.globalAlpha = alpha * t.fog * (0.5 + 0.2 * Math.sin(nowMs * 0.0004) + 0.2 * glowAmt);
      ctx.fillStyle = g.fog;
      ctx.fillRect(0, horizon - fogH, W, fogH * 1.5);
    }
    drawGround(t, g, alpha, glowAmt);
    ctx.globalAlpha = 1;
  };

  const drawEffects = (dom: Theme, wDark: number) => {
    // ground ripples (kick: sharp / bass: wide and slow)
    ctx.lineCap = 'butt';
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      if (rStr[i]! <= 0) continue;
      const t = rAge[i]! / rDur[i]!;
      const y = horizon + floorH * t * t;
      const a = (1 - t) * rStr[i]!;
      if (rKind[i] === 0) {
        ctx.strokeStyle = dom.rippleKick;
        ctx.globalAlpha = a * 0.85;
        ctx.lineWidth = 1.5 + 3 * (1 - t);
      } else {
        ctx.strokeStyle = dom.rippleBass;
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 3 + 5 * t;
      }
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // twinkling stars triggered by arp / lead pitch
    let col = -1;
    for (let i = 0; i < STAR_TOTAL; i++) {
      const b = starBoost[i]!;
      if (b < 0.03) continue;
      const ci = starCol[i]!;
      if (ci !== col) {
        ctx.fillStyle = PARTICLE_PALETTE[ci]!;
        col = ci;
      }
      const x = starX[i]! * W;
      const y = starY[i]! * horizon * 0.96;
      const s = 1 + starS[i]! + b * 2.2;
      ctx.globalAlpha = Math.min(1, b);
      ctx.fillRect(x - s, y, s * 2 + 1, 1);
      ctx.fillRect(x, y - s, 1, s * 2 + 1);
      ctx.globalAlpha = Math.min(1, b) * 0.4;
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }

    // particles (glow notes + sparkles)
    col = -1;
    for (let i = 0; i < pool.cap; i++) {
      const life = pool.life[i]!;
      if (life <= 0) continue;
      const p = pool.age[i]! / life;
      const fade = Math.sin(Math.PI * Math.min(1, p));
      const ci = pool.color[i]!;
      if (ci !== col) {
        ctx.fillStyle = PARTICLE_PALETTE[ci]!;
        col = ci;
      }
      const x = pool.x[i]!;
      const y = pool.y[i]!;
      const s = pool.size[i]!;
      if (pool.kind[i] === 0) {
        ctx.globalAlpha = fade * 0.18;
        ctx.beginPath();
        ctx.arc(x, y, s * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = fade * 0.95;
        ctx.fillRect(x, y, s, s);
        ctx.fillRect(x - s, y + s * 0.4, s * 3, Math.max(0.6, s * 0.3));
      }
    }

    // rain (dark theme)
    if (wDark > 0.01) {
      ctx.strokeStyle = '#9ec4ff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = wDark * 0.3;
      ctx.beginPath();
      for (let i = 0; i < RAIN_COUNT; i++) {
        ctx.moveTo(rainX[i]!, rainY[i]!);
        ctx.lineTo(rainX[i]! - rainL[i]! * 0.14, rainY[i]! + rainL[i]!);
      }
      ctx.stroke();
    }

    // flash / lightning
    if (flash > 0.01) {
      ctx.globalAlpha = flash * flash * dom.flashAlpha;
      ctx.fillStyle = dom.flashColor;
      ctx.fillRect(0, 0, W, H);
    }

    // section wipe: a soft light band sweeping across the scene
    if (wipe > 0.01 && wipeGrad) {
      const p = 1 - wipe;
      const e = p * p * (3 - 2 * p);
      ctx.save();
      ctx.translate(-wipeW + e * (W + wipeW), 0);
      ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, p)) * 0.9;
      ctx.fillStyle = wipeGrad;
      ctx.fillRect(0, 0, wipeW, H);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  // ---------------------------------------------------------------------------------------------
  // per-frame update
  // ---------------------------------------------------------------------------------------------
  const frame = (now: number, dt: number, playing: boolean): void => {
    nowMs = now;
    const st = useStore.getState();
    const feed = getFeedSource();
    const vis = getVisualizerSource();

    if (st.params.seed !== builtSeed) {
      rebuildSeed(st.params.seed);
      skylineDirty = true;
    }
    if (skylineDirty) {
      skyline = buildSkyline(st.params.seed, W);
      skylineDirty = false;
    }

    // audio level
    const lv = playing && vis ? vis.getLevel() : 0;
    level = smoothValue(level, lv > 0 ? (lv > 1 ? 1 : lv) : 0, dt, 40, 260);

    // theme cross-fade
    stepCrossfade(cf, st.params.mood, dt);

    // musical position, sections and events
    let bpm = 0;
    if (feed) {
      const beat = feed.getBeat();
      if (playing && dt > 0 && lastBeat >= 0 && beat > lastBeat && beat - lastBeat <= MAX_BEAT_GAP) {
        feed.forEachEvent(lastBeat, beat, onEvent);
      }
      lastBeat = beat;
      bpm = feed.getBpmAt(beat);
      const secs = feed.getSections();
      const si = findSectionIndex(secs, beat);
      if (si >= 0) {
        const sec = secs[si]!;
        secEnergy = sec.energy;
        if (sec.index !== lastSectionIndex) {
          if (lastSectionIndex >= 0 && playing) wipe = 1;
          lastSectionIndex = sec.index;
        }
      }
    }
    if (!(bpm > 0)) bpm = st.now.tempo > 0 ? st.now.tempo : 100;
    const energyTarget = secEnergy >= 0 && playing ? secEnergy : st.params.energy;
    energySm = smoothValue(energySm, energyTarget, dt, 700, 1200);
    const E = clamp01(0.6 * energySm + 0.4 * st.params.energy);

    if (dt > 0) {
      // impulses decay
      kick = decayImpulse(kick, dt, 220);
      gridFlash = decayImpulse(gridFlash, dt, 260);
      flash = decayImpulse(flash, dt, 130);
      bassShake = decayImpulse(bassShake, dt, 260);
      padPulse = decayImpulse(padPulse, dt, 900);
      wipe = Math.max(0, wipe - dt / WIPE_MS);
      for (let i = 0; i < STAR_TOTAL; i++) if (starBoost[i]! > 0) starBoost[i] = decayImpulse(starBoost[i]!, dt, 420);

      // scrolling
      const mul = playing ? scrollSpeed(bpm, E) : 0.18;
      ridgePx += 38 * mul * (dt / 1000) * motion;
      gridScroll += (0.3 + 0.45 * mul + kick * 0.5) * (dt / 1000) * motion;
      if (ridgePx > 1e7) ridgePx = 0;
      if (gridScroll > 1e6) gridScroll = 0;

      // idle life when nothing is playing
      if (!playing && motion) {
        idleTimer -= dt;
        if (idleTimer <= 0) {
          idleTimer = 350 + Math.random() * 700;
          const si = (Math.random() * STAR_TOTAL) | 0;
          starBoost[si] = 1;
          starCol[si] = (Math.random() * PARTICLE_PALETTE.length) | 0;
          if (Math.random() < 0.35) spawnSparkles(1, 1);
        }
      }

      // ripples
      for (let i = 0; i < RIPPLE_COUNT; i++) {
        if (rStr[i]! <= 0) continue;
        rAge[i] = rAge[i]! + dt;
        if (rAge[i]! >= rDur[i]!) rStr[i] = 0;
      }

      pool.step(dt);

      // rain
      const wind = 0.08;
      for (let i = 0; i < RAIN_COUNT; i++) {
        rainY[i] = rainY[i]! + rainV[i]! * dt * (0.8 + 0.4 * E) * motion;
        rainX[i] = rainX[i]! - rainV[i]! * dt * wind * motion;
        if (rainY[i]! > H) {
          rainY[i] = -rainL[i]!;
          rainX[i] = Math.random() * W + 20;
        }
      }
    }

    // ---- draw ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    const glowAmt = clamp01(0.2 + 0.5 * E + 0.35 * padPulse + 0.3 * level + 0.35 * kick);
    const w = crossfadeWeight(cf);
    const fading = cf.t < 1 && cf.from !== cf.to;
    if (fading) {
      drawTheme(themeFor(cf.from), 1, glowAmt);
      drawTheme(themeFor(cf.to), w, glowAmt);
    } else {
      drawTheme(themeFor(cf.to), 1, glowAmt);
    }
    const dom = themeFor(w > 0.5 ? cf.to : cf.from);
    const wDark = (cf.from === 'dark' ? 1 - w : 0) + (cf.to === 'dark' ? w : 0);
    drawEffects(dom, fading ? wDark : cf.to === 'dark' ? 1 : 0);
  };

  return { resize, frame };
};

export const LANDSCAPE_OPTIONS = { fpsActive: 45, fpsIdle: 24 };
