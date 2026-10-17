import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { LayerId, MoodId } from '@shared/index';
import { useStore } from '../services/store';
import { getDefaultValue } from '../tuning/defaults';
import type { TuningGroup } from '../tuning/schema';
import { SpectrumView, ScopeView, drawEnvelope, drawFilters, drawWaves, type WaveLane } from './labDraw';
import {
  buildFilterSpecs,
  cutoffFromOpenness,
  envelopeInputFromValues,
  envelopeShape,
  findEnvelopeParams,
  findOption,
  findSpreadParam,
  findUnisonParam,
  findWaveParams,
  focusInfo,
  unisonRatios,
  visualDetune,
  type FilterSpec,
  type VisualId,
} from './labMath';
import { getLabSource } from './labSource';
import { useLabUi } from './labState';

const LIVE_FPS = 45;

/** "Main voice wave shape" -> "Main voice: " (the lane is tiny); a bare "Wave shape" -> "". */
function shortWaveLabel(label: string): string {
  const t = label.replace(/\s*wave shape\s*/i, '').trim();
  return t ? `${t}: ` : '';
}

interface Props {
  group: TuningGroup;
  mood: MoodId;
}

type CellKind = 'scope' | 'spectrum' | VisualId;

const CELL_TITLE: Record<CellKind, string> = {
  scope: 'Live scope',
  spectrum: 'Live spectrum',
  wave: 'Wave shape',
  envelope: 'Envelope',
  filter: 'Filter',
};

const CELL_DESC: Record<CellKind, string> = {
  scope: 'Live waveform of the selected instrument',
  spectrum: 'Live frequency spectrum of the selected instrument',
  wave: 'Shape of the oscillator wave (stacked copies = fat / unison)',
  envelope: 'Volume over the life of one note: attack, decay, sustain, release',
  filter: 'Low-pass filter response; shaded band = range the music sweeps the cutoff through',
};

/**
 * Right-hand visuals panel. One rAF loop (only while mounted = dock open, and the tab is visible) draws:
 *  - live scope + spectrum every frame (capped), reading the injected LabSource buffers (no allocation per frame);
 *  - static wave / envelope / filter pictures only when a tuning value, the hovered param or the size changed.
 * The loop subscribes to the stores directly, so React never re-renders while a slider moves.
 */
export const LabVisuals = memo(function LabVisuals({ group, mood }: Props) {
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const envRef = useRef<HTMLCanvasElement>(null);
  const filterRef = useRef<HTMLCanvasElement>(null);
  const cellRefs = useRef<Partial<Record<CellKind, HTMLDivElement | null>>>({});

  const info = useMemo(() => {
    const waves = findWaveParams(group.params);
    const env = findEnvelopeParams(group.params);
    const hasFilter = buildFilterSpecs(group.params, () => 1000).length > 0;
    const kinds: CellKind[] = ['scope', 'spectrum'];
    if (waves.length > 0) kinds.push('wave');
    if (env.count > 0) kinds.push('envelope');
    if (hasFilter) kinds.push('filter');
    return { waves, env, kinds };
  }, [group]);

  useEffect(() => {
    const scopeC = scopeRef.current;
    const specC = specRef.current;
    if (!scopeC || !specC) return;
    const waveC = waveRef.current;
    const envC = envRef.current;
    const filterC = filterRef.current;
    const canvases = [scopeC, specC, waveC, envC, filterC].filter((c): c is HTMLCanvasElement => c !== null);
    const ctxs = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();
    const sizes = new Map<HTMLCanvasElement, { w: number; h: number; dpr: number }>();
    for (const c of canvases) {
      const ctx = c.getContext('2d', { alpha: false });
      if (!ctx) return;
      ctxs.set(c, ctx);
      sizes.set(c, { w: 0, h: 0, dpr: 1 });
    }

    const paramMin = new Map(group.params.map((p) => [p.key, p.min]));
    const layer: LayerId | null = group.id === 'fx' ? null : (group.id as LayerId);
    const scope = new ScopeView();
    const spectrum = new SpectrumView();
    const { waves, env } = info;

    let dirty = true;
    let idleText = '';
    let raf = 0;
    let running = false;
    let lastLive = 0;
    let lastFrame = 0;
    let lastComposerVer = -1;

    const get = (key: string): number => {
      const src = getLabSource();
      const live = src?.getComposerLiveParam?.(key);
      if (live !== undefined && Number.isFinite(live)) return live;
      const o = useStore.getState().tuning[mood]?.[key];
      if (o !== undefined && Number.isFinite(o)) return o;
      return getDefaultValue(mood, key) ?? paramMin.get(key) ?? 0;
    };

    const refreshIdle = () => {
      const st = useStore.getState();
      if (layer === null) idleText = 'FX: nothing to monitor';
      else if (!st.audioReady) idleText = 'Start audio to see live';
      else if (!st.playing) idleText = 'Press play to see live';
      else if (st.muted[layer] === true) idleText = 'Muted';
      else if (st.solo !== null && st.solo !== layer) idleText = 'Silent (other soloed)';
      else idleText = 'No signal';
    };

    const prep = (c: HTMLCanvasElement): CanvasRenderingContext2D | null => {
      const s = sizes.get(c)!;
      if (s.w < 2 || s.h < 2) return null;
      const ctx = ctxs.get(c)!;
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      return ctx;
    };

    const drawStatic = () => {
      const focusKey = useLabUi.getState().focusKey;
      let specs = buildFilterSpecs(group.params, get, group.label);
      const src = layer !== null ? getLabSource() : null;
      if (layer && src?.getComposerFilterOpenness) {
        const open = src.getComposerFilterOpenness(layer);
        if (open !== undefined) {
          specs = specs.map((s): FilterSpec => {
            if (s.cutMax <= s.cutMin * 1.02) return s;
            return { ...s, liveCutHz: cutoffFromOpenness(open, s.cutMin, s.cutMax) };
          });
        }
      }
      const focus = focusInfo(group.params, focusKey, specs);
      for (const kind of ['wave', 'envelope', 'filter'] as const) {
        cellRefs.current[kind]?.classList.toggle('is-hot', focus.visual === kind);
      }
      if (waveC) {
        const ctx = prep(waveC);
        if (ctx) {
          const lanes: WaveLane[] = [];
          const spread = findSpreadParam(group.params);
          const detune = visualDetune(spread ? get(spread.key) : undefined);
          for (const p of waves) {
            const opt = findOption(p, get(p.key));
            if (!opt || !opt.wave) continue;
            const uni = findUnisonParam(group.params, p.key);
            const count = uni ? get(uni.key) : opt.fat ? 3 : 1;
            const hot = focusKey === p.key || (uni !== undefined && focusKey === uni.key) || (spread !== undefined && focusKey === spread.key);
            lanes.push({ label: `${shortWaveLabel(p.label)}${opt.label}${count > 1 ? ` x${Math.round(count)}` : ''}`, wave: opt.wave, ratios: unisonRatios(count, detune), highlight: hot });
          }
          drawWaves(ctx, sizes.get(waveC)!.w, sizes.get(waveC)!.h, lanes);
        }
      }
      if (envC) {
        const ctx = prep(envC);
        if (ctx) {
          const shape = envelopeShape(envelopeInputFromValues(env, get));
          drawEnvelope(ctx, sizes.get(envC)!.w, sizes.get(envC)!.h, shape, focus.visual === 'envelope' ? (focus.role ?? null) : null);
        }
      }
      if (filterC) {
        const ctx = prep(filterC);
        if (ctx) drawFilters(ctx, sizes.get(filterC)!.w, sizes.get(filterC)!.h, specs, focus);
      }
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const srcCheck = getLabSource();
      const cVer = srcCheck?.getComposerLiveVersion?.() ?? 0;
      if (cVer !== lastComposerVer) {
        lastComposerVer = cVer;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        refreshIdle();
        drawStatic();
      }
      if (t - lastLive < 1000 / LIVE_FPS - 1) return;
      lastLive = t;
      const dt = lastFrame === 0 ? 16 : Math.min(100, t - lastFrame);
      lastFrame = t;
      const src = layer !== null ? getLabSource() : null;
      const sCtx = prep(scopeC);
      if (sCtx) {
        const s = sizes.get(scopeC)!;
        scope.draw(sCtx, s.w, s.h, src ? src.getMonitorWaveform() : null, dt, idleText);
      }
      const pCtx = prep(specC);
      if (pCtx) {
        const s = sizes.get(specC)!;
        spectrum.draw(pCtx, s.w, s.h, src ? src.getMonitorSpectrum() : null, src ? src.getSampleRate() || 44100 : 44100, t, dt, idleText);
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      lastFrame = 0;
      dirty = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const resize = (c: HTMLCanvasElement) => {
      const host = c.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const s = sizes.get(c)!;
      if (s.w === w && s.h === h && s.dpr === dpr) return;
      s.w = w;
      s.h = h;
      s.dpr = dpr;
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      dirty = true;
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const c = e.target.querySelector('canvas');
        if (c && sizes.has(c)) resize(c);
      }
    });
    for (const c of canvases) {
      resize(c);
      if (c.parentElement) ro.observe(c.parentElement);
    }

    const unsubStore = useStore.subscribe((s, prev) => {
      if (s.tuning !== prev.tuning || s.playing !== prev.playing || s.audioReady !== prev.audioReady || s.solo !== prev.solo || s.muted !== prev.muted) {
        dirty = true;
      }
    });
    const unsubUi = useLabUi.subscribe((s, prev) => {
      if (s.focusKey !== prev.focusKey) dirty = true;
    });
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      ro.disconnect();
      unsubStore();
      unsubUi();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [group, mood, info]);

  const odd = info.kinds.length % 2 === 1;
  const showEnginePill = useStore((s) => s.playing && s.backend.engineId === 'js-auteur');
  const canvasRefFor: Record<CellKind, RefObject<HTMLCanvasElement>> = {
    scope: scopeRef,
    spectrum: specRef,
    wave: waveRef,
    envelope: envRef,
    filter: filterRef,
  };

  return (
    <section className="lab-vis" aria-label="Visuals">
      {info.kinds.map((kind, i) => (
        <div
          key={kind}
          className={`lab-vis__cell lab-vis__cell--${kind}${odd && i === info.kinds.length - 1 ? ' is-wide' : ''}`}
          ref={(el) => {
            cellRefs.current[kind] = el;
          }}
        >
          <h3 className="lab-vis__title" title={CELL_DESC[kind]}>
            {CELL_TITLE[kind]}
            {showEnginePill && (kind === 'wave' || kind === 'envelope' || kind === 'filter') && (
              <span className="lab-vis__engine-pill" title="Shape follows live composer automation">
                engine
              </span>
            )}
          </h3>
          <div className="lab-vis__plot">
            <canvas ref={canvasRefFor[kind]} className="lab-vis__canvas" role="img" aria-label={CELL_DESC[kind]} />
          </div>
        </div>
      ))}
    </section>
  );
});
