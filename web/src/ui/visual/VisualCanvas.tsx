import { useEffect, useRef } from 'react';
import { useStore } from '../../services/store';
import type { SceneFactory, SceneOptions } from './canvasScene';

interface Props {
  factory: SceneFactory;
  options: SceneOptions;
  label: string;
  /** show the GHOST FREQUENCY wordmark in the top-left corner */
  title?: boolean;
  className?: string;
}

/**
 * Generic canvas host: owns the rAF loop (fps cap, paused while the tab is hidden), DPR-aware resizing and cleanup.
 * The scene itself is created once per mount; unmounting stops the loop and disposes the scene.
 */
export function VisualCanvas({ factory, options, label, title, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const scene = factory(ctx);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let raf = 0;
    let last = 0;
    let lastDraw = 0;
    let phase = 0;
    let running = false;
    let sized = false;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      scene.resize(w, h, dpr);
      sized = true;
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const playing = useStore.getState().playing;
      const interval = 1000 / (playing ? options.fpsActive : options.fpsIdle);
      if (t - lastDraw < interval - 1) return;
      lastDraw = t;
      const dt = last === 0 ? 16 : Math.min(100, t - last);
      last = t;
      if (!reducedMotion) phase += dt;
      scene.frame(phase, dt, playing);
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
      if (!running && sized) scene.frame(phase, 0, useStore.getState().playing); // repaint while paused
    });
    ro.observe(wrap);
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      scene.dispose?.();
    };
    // factory/options are stable module-level values for a given mode (the host remounts on mode change)
  }, []);

  return (
    <div className={className ? `visualizer ${className}` : 'visualizer'} ref={wrapRef}>
      <canvas ref={canvasRef} className="visualizer__canvas" role="img" aria-label={label} />
      {title ? (
        <div className="visualizer__title" aria-hidden="true">
          GHOST<span> FREQUENCY</span>
        </div>
      ) : null}
    </div>
  );
}
