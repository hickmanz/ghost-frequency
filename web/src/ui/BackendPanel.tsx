import { getController } from '../services/controller';
import {
  connectBackend,
  disablePythonMode,
  disconnectBackend,
  isPythonMode,
} from '../services/backendService';
import { useStore, type BackendStatus } from '../services/store';

const STATUS_LABEL: Record<BackendStatus, string> = {
  disabled: 'Disabled',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
};

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

  const sourceLabel =
    backend.activeSource === 'local'
      ? 'Fallback: JS'
      : backend.activeSource === 'remote'
        ? `Python: ${backend.engineId === 'local-js' ? 'py-markov' : backend.engineId}`
        : null;

  async function onModeChange(mode: 'browser' | 'python') {
    if (mode === 'browser') {
      disablePythonMode();
      await getController().regenerate();
      return;
    }
    setBackend({
      mode: 'python',
      status: 'disconnected',
      engineId: backend.engineId === 'local-js' ? 'py-markov' : backend.engineId,
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
    if (python && connected) await getController().regenerate();
  }

  return (
    <section className="panel backend" aria-labelledby="backend-title">
      <div className="panel__head">
        <h2 id="backend-title" className="panel__title">
          Engine
        </h2>
        <span className={`pill pill--${backend.status}`} role="status">
          <span className="pill__dot" aria-hidden="true" />
          {STATUS_LABEL[backend.status]}
        </span>
      </div>

      {sourceLabel && python && (
        <p className="note" role="status">
          Active: {sourceLabel}
          {backend.latencyMs ? ` · ${backend.latencyMs} ms` : ''}
        </p>
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
            value={backend.engineId}
            disabled={!python}
            onChange={(e) => void onEngineChange(e.currentTarget.value)}
          >
            {(python
              ? backend.engines.filter((en) => en.id !== 'local-js')
              : backend.engines.filter((en) => en.id === 'local-js')
            ).map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
            {python && backend.engines.every((e) => e.id !== 'py-markov') && (
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
