import { memo, useId, type CSSProperties } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange(v: number): void;
  /** text shown at right; defaults to percent of range */
  display?: string;
  disabled?: boolean;
  variant?: 'default' | 'mixer';
  accent?: 'cyan' | 'magenta' | 'violet';
  title?: string;
}

function SliderImpl({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  display,
  disabled,
  variant = 'default',
  accent = 'magenta',
  title,
}: SliderProps) {
  const id = useId();
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const shown = display ?? `${Math.round(pct)}%`;
  const style = { '--pct': `${pct}%` } as CSSProperties;
  return (
    <div className={`slider slider--${variant} slider--${accent}${disabled ? ' is-disabled' : ''}`} title={title}>
      <label className="slider__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={style}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <output className="slider__value" htmlFor={id}>
        {shown}
      </output>
    </div>
  );
}

export const Slider = memo(SliderImpl);
