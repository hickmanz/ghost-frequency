import { memo, useCallback, useId, useRef, type DragEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

interface KnobProps {
  label: string;
  value: number;
  onChange(v: number): void;
  display?: string;
  defaultValue?: number;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  title?: string;
  mod?: number;
  pinned?: boolean;
  onTogglePin?: () => void;
  onInteractStart?: () => void;
}

const SWEEP = 270;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function KnobImpl({ label, value, onChange, display, defaultValue, size = 'sm', disabled, title, mod, pinned, onTogglePin, onInteractStart }: KnobProps) {
  const id = useId();
  const drag = useRef<{ y: number; v: number; id: number } | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const shown = display ?? `${Math.round(value * 100)}%`;
  const angle = -SWEEP / 2 + value * SWEEP;
  const set = useCallback((v: number) => onChange(Math.round(clamp01(v) * 1000) / 1000), [onChange]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dialRef.current?.focus({ preventScroll: true });
    onInteractStart?.();
    drag.current = { y: e.clientY, v: value, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.buttons === 0 && e.pointerType === 'mouse') {
      drag.current = null;
      return;
    }
    const fine = e.shiftKey ? 0.25 : 1;
    set(d.v + ((d.y - e.clientY) / 180) * fine);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (disabled || document.activeElement !== e.currentTarget) return;
    set(value - Math.sign(e.deltaY) * 0.02);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    let v: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = value + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = value - step;
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 1;
    if (v !== null) {
      e.preventDefault();
      set(v);
    }
  };

  const modPos = mod !== undefined ? clamp01(mod) : undefined;

  return (
    <div className={`knob knob--${size}${disabled ? ' is-disabled' : ''}${pinned ? ' is-pinned' : ''}`} title={title}>
      {onTogglePin && (
        <button type="button" className="knob__pin" aria-pressed={pinned} onClick={(e) => { e.stopPropagation(); onTogglePin(); }} title={pinned ? 'Unpin' : 'Pin'}>
          {pinned ? '◆' : '◇'}
        </button>
      )}
      <div
        ref={dialRef}
        className="knob__dial"
        title={title}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={shown}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onDragStart={(e: DragEvent) => e.preventDefault()}
        onDoubleClick={() => defaultValue !== undefined && !disabled && set(defaultValue)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle className="knob__track" cx="32" cy="32" r="27" pathLength={360} strokeDasharray={`${SWEEP} 360`} transform="rotate(135 32 32)" />
          <circle className="knob__fill" cx="32" cy="32" r="27" pathLength={360} strokeDasharray={`${value * SWEEP} 360`} transform="rotate(135 32 32)" />
          {modPos !== undefined && Math.abs(modPos - value) > 0.004 && (
            <circle
              className="knob__mod"
              r={3.2}
              cx={32 + 27 * Math.cos(((135 + modPos * SWEEP) * Math.PI) / 180)}
              cy={32 + 27 * Math.sin(((135 + modPos * SWEEP) * Math.PI) / 180)}
            />
          )}
        </svg>
        <div className="knob__cap" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="knob__mark" />
        </div>
      </div>
      <div className="knob__label" id={id}>{label}</div>
      <div className="knob__value">{shown}</div>
    </div>
  );
}

export const Knob = memo(KnobImpl);
