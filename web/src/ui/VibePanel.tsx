import { useState } from 'react';
import { DEFAULT_VIBE } from '@shared/index';
import { isPythonMode, sendVibePrompt } from '../services/backendService';
import { useStore } from '../services/store';
import { Slider } from './Slider';
import { notify } from './uiState';

export function VibePanel() {
  const vibe = useStore((s) => s.params.vibe ?? DEFAULT_VIBE);
  const setParams = useStore((s) => s.setParams);
  const python = isPythonMode();
  const connected = useStore((s) => s.backend.status === 'connected');
  const [prompt, setPrompt] = useState('');

  const setVibe = (patch: Partial<typeof vibe>) => {
    setParams({ vibe: { ...DEFAULT_VIBE, ...vibe, ...patch } });
  };

  const applyPrompt = () => {
    const text = prompt.trim();
    if (!text) return;
    if (python && connected) {
      sendVibePrompt(text);
      notify('Vibe prompt sent to Python server.');
    } else {
      notify('Connect to the Python server to apply text prompts.', 'error');
    }
  };

  return (
    <section className="panel vibe" aria-labelledby="vibe-title">
      <h2 id="vibe-title" className="panel__title">
        Vibe
      </h2>
      <p className="note">
        In the browser, vibe nudges steering (harmony colour, motion, swing, density, lead). On Python neural engines it
        drives model conditioning; text prompts apply there when connected.
      </p>
      <div className="generation__sliders">
        <Slider label="Brightness" value={vibe.brightness} onChange={(v) => setVibe({ brightness: v })} accent="cyan" />
        <Slider label="Tension" value={vibe.tension} onChange={(v) => setVibe({ tension: v })} accent="magenta" />
        <Slider label="Density" value={vibe.density} onChange={(v) => setVibe({ density: v })} accent="violet" />
        <Slider label="Groove" value={vibe.groove} onChange={(v) => setVibe({ groove: v })} accent="cyan" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="vibe-prompt">
          Text prompt
        </label>
        <textarea
          id="vibe-prompt"
          className="input"
          rows={2}
          value={prompt}
          placeholder="e.g. rainy neon drive, melancholic"
          onChange={(e) => setPrompt(e.currentTarget.value)}
        />
      </div>
      <button type="button" className="btn btn--small" onClick={applyPrompt} disabled={!prompt.trim()}>
        Apply prompt
      </button>
    </section>
  );
}
