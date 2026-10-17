import { getController } from '../services/controller';
import {
  connectBackend,
  disablePythonMode,
  disconnectBackend,
  isPythonMode,
} from '../services/backendService';
import { browserEngineDescription, listBrowserEngines } from '../engines/registry';
import { useStore, type BackendStatus } from '../services/store';

const STATUS_LABEL: Record<BackendStatus, string> = {
  disabled: 'Disabled',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
};

const BROWSER_ENGINE_IDS = new Set(listBrowserEngines().map((e) => e.id));

function httpsNonLocalHint(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.protocol !== 'https:') return null;
  const url = useStore.getState().backend.url;
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return 'This page is HTTPS but the backend is on localhost. Your browser may block or prompt for local network access.';
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function BackendPanel() {
  const backend = useStore((s) => s.backend);
  const setBackend = useStore((s) => s.setBackend);
  const python = backend.mode === 'python';
  const connected = backend.status === 'connected';
  const hint = python ? httpsNonLocalHint() : null;

  const engineOptions = python
    ? backend.engines.filter((en) => !BROWSER_ENGINE_IDS.has(en.id))
    : backend.engines.filter((en) => BROWSER_ENGINE_IDS.has(en.id));

  const activeEngineDesc = browserEngineDescription(backend.engineId);

  const sourceLabel = python
    ? backend.activeSource === 'local'
      ? 'Fallback: JS (full default)'
      : backend.activeSource === 'remote'
        ? `Python: ${BROWSER_ENGINE_IDS.has(backend.engineId) ? 'py-markov' : backend.engineId}`
        : null
    : engineOptions.find((e) => e.id === backend.engineId)?.name ?? backend.engineId;

  async function onModeChange(mode: 'browser' | 'python') {
    if (mode === 'browser') {
      disablePythonMode();
      await getController().regenerate();
      return;
    }
    setBackend({
      mode: 'python',
      status: 'disconnected',
      engineId: BROWSER_ENGINE_IDS.has(backend.engineId) ? 'py-markov' : backend.engineId,
    });
  }

  async function onConnectToggle() {
    if (connected) {
      disconnectBackend();
      return;
    }
    try {
      await connectBackend();
    } catch {
      /* store updated */
    }
  }

  async function onEngineChange(id: string) {
    setBackend({ engineId: id });
    if (!python || connected) await getController().regenerate();
  }

  return (
    <section className="panel backend" aria-labelledby="backend-title">
      <div className="panel__head">
        <h2 id="backend-title" className="panel__title">
          Engine
        </h2>
        <span className={`pill pill--${backend.status}`} role="status">
          <span className="pill__dot" aria-hidden="true" />
          {python ? STATUS_LABEL[backend.status] : 'Browser'}
        </span>
      </div>

      {sourceLabel && (
        <p className="note" role="status">
          {python ? `Active: ${sourceLabel}` : `Composition: ${sourceLabel}`}
          {backend.latencyMs ? ` · ${backend.latencyMs} ms` : ''}
        </p>
      )}

      {!python && activeEngineDesc && (
        <p className="note">{activeEngineDesc}</p>
      )}

      {backend.lastError && (
        <p className="note note--warn" role="alert">
          {backend.lastError}
        </p>
      )}

      {hint && <p className="note note--warn">{hint}</p>}

      <div className="radios" role="radiogroup" aria-label="Composition backend">
        <label className="radio">
          <input
            type="radio"
            name="backend-mode"
            checked={!python}
            onChange={() => void onModeChange('browser')}
          />
          <span className="radio__dot" aria-hidden="true" />
          <span>Browser-only</span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="backend-mode"
            checked={python}
            onChange={() => void onModeChange('python')}
          />
          <span className="radio__dot" aria-hidden="true" />
          <span>Local Python server</span>
        </label>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="backend-url">
          Server URL
        </label>
        <input
          id="backend-url"
          className="input input--mono"
          type="url"
          value={backend.url}
          disabled={!python}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setBackend({ url: e.currentTarget.value })}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="backend-token">
          Pairing token
        </label>
        <input
          id="backend-token"
          className="input input--mono"
          type="password"
          value={backend.token}
          disabled={!python}
          spellCheck={false}
          autoComplete="off"
          placeholder="From server startup log"
          onChange={(e) => setBackend({ token: e.currentTarget.value })}
        />
      </div>

      <div className="field field--row">
        <div className="field__grow">
          <label className="field__label" htmlFor="backend-engine">
            Composition engine
          </label>
          <select
            id="backend-engine"
            className="input"
            value={python && BROWSER_ENGINE_IDS.has(backend.engineId) ? 'py-markov' : backend.engineId}
            onChange={(e) => void onEngineChange(e.currentTarget.value)}
          >
            {engineOptions.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
            {python && engineOptions.every((e) => e.id !== 'py-markov') && (
              <option value="py-markov">Python Markov (harmony graph)</option>
            )}
          </select>
        </div>
        <button
          type="button"
          className="btn btn--small"
          disabled={!python || backend.status === 'connecting'}
          onClick={() => void onConnectToggle()}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {python && !connected && isPythonMode() && (
        <p className="note">Connect to use Python generation. Playback falls back to JS until bars are buffered.</p>
      )}
    </section>
  );
}
