/** Vertical mixer fader (night-tape style range input + styled thumb). */
interface MixerFaderProps {
  label: string;
  value: number;
  onChange(v: number): void;
  className?: string;
}

export function MixerFader({ label, value, onChange, className = '' }: MixerFaderProps) {
  return (
    <div className={`fader${className ? ` ${className}` : ''}`}>
      <input
        className="fader__input"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={`${label} level`}
        aria-valuetext={`${Math.round(value * 100)}%`}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <div className="fader__label">{label}</div>
      <div className="fader__readout" aria-hidden="true">
        {Math.round(value * 100)}
      </div>
    </div>
  );
}
