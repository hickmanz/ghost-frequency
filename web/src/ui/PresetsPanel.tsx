import { useRef, useState, type FormEvent } from 'react';
import type { Preset } from '@shared/index';
import { useStore } from '../services/store';
import {
  MAX_NAME_LENGTH,
  loadPresets,
  makePreset,
  parsePresets,
  removePreset,
  savePresets,
  serializePresets,
  upsertPreset,
} from '../services/presets';
import { notify, regenerateWithSeed } from './uiState';

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PresetsPanel() {
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const commit = (next: Preset[]) => {
    setPresets(next);
    if (!savePresets(next)) notify('Could not write presets to browser storage (quota or privacy mode).', 'error');
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const { params, mixer, tone, chaos, pins, tuning } = useStore.getState();
    const preset = makePreset(name, params, mixer, Date.now(), { tone, chaos, pins, tuning });
    if (!preset) return;
    commit(upsertPreset(presets, preset));
    setName('');
    notify(`Saved preset "${preset.name}".`);
  };

  const load = (p: Preset) => {
    const playingSeed = useStore.getState().params.seed;
    const st = useStore.getState();
    st.replaceAll(p.params, p.mixer);
    if (p.params.steer) st.setSteer(p.params.steer);
    if (p.tone) st.setTone(p.tone);
    if (p.chaos) st.setChaos(p.chaos);
    if (p.tuning) st.replaceTuning(p.tuning);
    if (p.pins) useStore.setState({ pins: { ...p.pins } });
    if (p.params.seed !== playingSeed) void regenerateWithSeed(p.params.seed);
    notify(`Loaded "${p.name}".`);
  };

  const exportAll = () => {
    if (presets.length === 0) return;
    downloadText('ghost-frequency-presets.json', serializePresets(presets));
  };

  const copyAll = async () => {
    if (presets.length === 0) return;
    try {
      await navigator.clipboard.writeText(serializePresets(presets));
      notify('Presets JSON copied to clipboard.');
    } catch {
      notify('Could not copy to clipboard.', 'error');
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = parsePresets(text);
      if (incoming.length === 0) {
        notify('No valid presets found in that file.', 'error');
        return;
      }
      commit(incoming.reduce((acc, p) => upsertPreset(acc, p), presets));
      notify(`Imported ${incoming.length} preset${incoming.length === 1 ? '' : 's'}.`);
    } catch {
      notify('Could not read that file.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="panel presets" aria-labelledby="presets-title">
      <h2 id="presets-title" className="panel__title">
        Presets
      </h2>

      <form className="presets__save" onSubmit={save}>
        <label className="visually-hidden" htmlFor="preset-name">
          Preset name
        </label>
        <input
          id="preset-name"
          className="input"
          type="text"
          placeholder="Name this setup..."
          maxLength={MAX_NAME_LENGTH}
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <button type="submit" className="btn btn--small btn--primary" disabled={name.trim().length === 0}>
          Save
        </button>
      </form>

      {presets.length === 0 ? (
        <p className="presets__empty">No saved presets yet.</p>
      ) : (
        <ul className="presets__list">
          {presets.map((p) => (
            <li key={p.name} className="preset">
              <button type="button" className="preset__load" onClick={() => load(p)} title="Load preset">
                <span className="preset__name">{p.name}</span>
                <span className="preset__meta">
                  {p.params.mood} - seed {p.params.seed}
                </span>
              </button>
              <button
                type="button"
                className="btn btn--small btn--danger"
                aria-label={`Delete preset ${p.name}`}
                onClick={() => commit(removePreset(presets, p.name))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="presets__io">
        <button type="button" className="btn btn--small" onClick={exportAll} disabled={presets.length === 0}>
          Export
        </button>
        <button type="button" className="btn btn--small" onClick={() => void copyAll()} disabled={presets.length === 0}>
          Copy JSON
        </button>
        <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label="Import presets file"
          onChange={(e) => void importFile(e.currentTarget.files?.[0])}
        />
      </div>
    </section>
  );
}
