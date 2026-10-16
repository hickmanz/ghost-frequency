import { useEffect, useState } from 'react';
import { MOOD_IDS, type MoodId } from '@shared/index';
import { useStore } from '../services/store';
import { SEED_MAX, TEMPO_MAX, TEMPO_MIN, clamp } from '../services/presets';
import { Slider } from './Slider';
import { notify, randomSeed, regenerateWithSeed } from './uiState';

const MOODS: Record<MoodId, { name: string; blurb: string }> = {
  dreamy: { name: 'Dreamy', blurb: 'Lush pads, floating arps, soft major-7 haze.' },
  dark: { name: 'Dark', blurb: 'Minor drones, driving bass, midnight neon.' },
  nostalgic: { name: 'Nostalgic', blurb: 'Warm analog 80s, bittersweet melodies.' },
  space: { name: 'Space Ambient', blurb: 'Slow drifting textures, vast reverb.' },
};

function MoodSelector() {
  const mood = useStore((s) => s.params.mood);
  const setParams = useStore((s) => s.setParams);
  return (
    <div className="moods" role="radiogroup" aria-label="Mood">
      {MOOD_IDS.map((id) => {
        const selected = id === mood;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`mood mood--${id}${selected ? ' is-selected' : ''}`}
            onClick={() => setParams({ mood: id })}
          >
            <span className="mood__name">{MOODS[id].name}</span>
            <span className="mood__blurb">{MOODS[id].blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

function TempoControl() {
  const tempo = useStore((s) => s.params.tempo);
  const setParams = useStore((s) => s.setParams);
  const auto = tempo === null;
  // while auto, show the tempo the engine picked (read-only) as the slider position
  const nowTempo = useStore((s) => s.now.tempo);
  const shown = tempo ?? Math.round(clamp(nowTempo > 0 ? nowTempo : 90, TEMPO_MIN, TEMPO_MAX));

  const toggleAuto = (checked: boolean) => {
    if (checked) setParams({ tempo: null });
    else setParams({ tempo: shown });
  };

  return (
    <div className="tempo">
      <Slider
        label="Tempo"
        value={shown}
        min={TEMPO_MIN}
        max={TEMPO_MAX}
        step={1}
        display={auto ? `Auto (${shown})` : `${shown} BPM`}
        disabled={auto}
        accent="cyan"
        onChange={(v) => setParams({ tempo: v })}
      />
      <label className="toggle">
        <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.currentTarget.checked)} />
        <span className="toggle__box" aria-hidden="true" />
        <span className="toggle__text">Auto</span>
      </label>
    </div>
  );
}

const SEED_RE = /^\d{1,10}$/;

function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!SEED_RE.test(t)) return null;
  const n = Number(t);
  return n <= SEED_MAX ? n : null;
}

function SeedControl() {
  const seed = useStore((s) => s.params.seed);
  const busy = useStore((s) => s.busy);
  const [draft, setDraft] = useState(String(seed));

  // keep the field in sync when the seed changes elsewhere (regenerate, preset load)
  useEffect(() => {
    setDraft(String(seed));
  }, [seed]);

  const parsed = parseSeed(draft);
  const valid = parsed !== null;
  const apply = () => {
    if (parsed !== null) void regenerateWithSeed(parsed);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(seed));
      notify(`Seed ${seed} copied.`);
    } catch {
      notify('Could not copy to clipboard.', 'error');
    }
  };

  return (
    <div className="seed">
      <label className="seed__label" htmlFor="seed-input">
        Seed
      </label>
      <div className="seed__row">
        <input
          id="seed-input"
          className={`input input--mono${valid ? '' : ' is-invalid'}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-invalid={!valid}
          aria-describedby="seed-help"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
        <button type="button" className="btn btn--small" onClick={apply} disabled={!valid || busy} title="Regenerate with this seed">
          Apply
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void regenerateWithSeed(randomSeed())}
          disabled={busy}
          title="New random seed and regenerate"
        >
          Randomize
        </button>
        <button type="button" className="btn btn--small" onClick={() => void copy()} title="Copy seed">
          Copy
        </button>
      </div>
      <p id="seed-help" className={`seed__help${valid ? '' : ' is-error'}`}>
        {valid ? 'Same seed + settings = same music. Enter applies.' : `Enter an integer 0 - ${SEED_MAX}.`}
      </p>
    </div>
  );
}

export function GenerationPanel() {
  const energy = useStore((s) => s.params.energy);
  const complexity = useStore((s) => s.params.complexity);
  const variation = useStore((s) => s.params.variation);
  const setParams = useStore((s) => s.setParams);
  return (
    <section className="panel generation" aria-labelledby="gen-title">
      <h2 id="gen-title" className="panel__title">
        Generation
      </h2>
      <MoodSelector />
      <div className="generation__sliders">
        <Slider label="Energy" value={energy} onChange={(v) => setParams({ energy: v })} accent="magenta" />
        <Slider label="Complexity" value={complexity} onChange={(v) => setParams({ complexity: v })} accent="violet" />
        <Slider label="Variation" value={variation} onChange={(v) => setParams({ variation: v })} accent="cyan" />
        <TempoControl />
      </div>
      <SeedControl />
    </section>
  );
}
