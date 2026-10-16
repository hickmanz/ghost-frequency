import { memo, type ReactNode } from 'react';
import { useStore } from '../services/store';
import { randomSeed, regenerateWithSeed, togglePlayback } from './uiState';

function PlayButton() {
  const playing = useStore((s) => s.playing);
  return (
    <button
      type="button"
      className={`btn btn--primary btn--play${playing ? ' is-active' : ''}`}
      onClick={() => void togglePlayback()}
      aria-pressed={playing}
      aria-label={playing ? 'Pause' : 'Play'}
      title="Play / Pause (Space)"
    >
      <span className="btn__icon" aria-hidden="true">
        {playing ? '❚❚' : '▶'}
      </span>
      <span>{playing ? 'Pause' : 'Play'}</span>
    </button>
  );
}

function RegenerateButton() {
  const busy = useStore((s) => s.busy);
  return (
    <button
      type="button"
      className={`btn btn--secondary${busy ? ' is-busy' : ''}`}
      disabled={busy}
      aria-busy={busy}
      onClick={() => void regenerateWithSeed(randomSeed())}
      title="Compose something new (new random seed)"
    >
      <span className="btn__icon" aria-hidden="true">
        {busy ? '◌' : '⟳'}
      </span>
      <span>{busy ? 'Composing...' : 'Regenerate'}</span>
    </button>
  );
}

function Readout({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`readout ${className}`}>
      <span className="readout__label">{label}</span>
      <span className="readout__value">{children}</span>
    </div>
  );
}

const KeyReadout = memo(function KeyReadout() {
  const key = useStore((s) => s.now.keyLabel);
  return <Readout label="Key">{key}</Readout>;
});

const TempoReadout = memo(function TempoReadout() {
  const tempo = useStore((s) => s.now.tempo);
  return <Readout label="Tempo">{tempo > 0 ? `${Math.round(tempo)} BPM` : '-'}</Readout>;
});

const SectionReadout = memo(function SectionReadout() {
  const name = useStore((s) => s.now.sectionName);
  const idx = useStore((s) => s.now.sectionIndex);
  return (
    <Readout label="Section">
      {name}
      <span className="readout__sub"> #{idx + 1}</span>
    </Readout>
  );
});

const BarReadout = memo(function BarReadout() {
  const bar = useStore((s) => s.now.bar);
  const beat = useStore((s) => s.now.beatInBar);
  return (
    <Readout label="Bar . Beat" className="readout--counter">
      {bar + 1}.{Math.floor(beat) + 1}
    </Readout>
  );
});

const ChordReadout = memo(function ChordReadout() {
  const chord = useStore((s) => s.now.chordLabel);
  return (
    <div className="chord" aria-live="off">
      <span className="chord__label">Chord</span>
      <span className="chord__value" key={chord}>
        {chord}
      </span>
    </div>
  );
});

export function Transport() {
  return (
    <section className="transport panel" aria-label="Transport">
      <div className="transport__buttons">
        <PlayButton />
        <RegenerateButton />
      </div>
      <ChordReadout />
      <div className="transport__readouts">
        <KeyReadout />
        <TempoReadout />
        <SectionReadout />
        <BarReadout />
      </div>
    </section>
  );
}
