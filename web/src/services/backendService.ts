import { DEFAULT_PARAMS, type GenerationParams } from '@shared/index';
import { FailoverEngine } from '../engines/failoverEngine';
import {
  createBrowserEngine,
  DEFAULT_BROWSER_ENGINE_ID,
  listBrowserEngines,
  normalizeBrowserEngineId,
} from '../engines/registry';
import { RemoteEngine } from '../engines/remoteEngine';
import type { ComposerEngine } from '../engines/types';
import { BackendClient } from './backendClient';
import { useStore } from './store';

let client: BackendClient | null = null;
let remote: RemoteEngine | null = null;
let failover: FailoverEngine | null = null;

export function getBackendClient(): BackendClient {
  if (!client) {
    client = new BackendClient({
      onMessage: (msg) => {
        if (msg.type === 'ready') {
          useStore.getState().setBackend({
            engines: [...listBrowserEngines(), ...msg.engines],
          });
        }
      },
      onStatus: (status) => {
        const st = useStore.getState();
        const map = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : status === 'error' ? 'error' : 'disconnected';
        st.setBackend({ status: map });
        failover?.bindRemoteConnected(status === 'connected');
        if (status === 'connected' && remote) {
          const p = st.params;
          remote.init(p.seed, p);
        }
      },
      onError: (code, message) => {
        useStore.getState().setBackend({ lastError: `${code}: ${message}`, status: 'error' });
      },
    });
    remote = new RemoteEngine(client);
    failover = new FailoverEngine(remote);
  }
  return client;
}

export function createEngineFactory(): () => ComposerEngine {
  return () => {
    const st = useStore.getState().backend;
    if (st.mode === 'python') {
      getBackendClient();
      const engId = st.engineId;
      const isBrowserId = listBrowserEngines().some((e) => e.id === engId);
      const pyId = isBrowserId || engId === 'local-js' ? 'py-markov' : engId;
      remote!.setEngineId(pyId);
      return failover!;
    }
    return createBrowserEngine(normalizeBrowserEngineId(st.engineId));
  };
}

export async function connectBackend(): Promise<void> {
  const st = useStore.getState();
  const c = getBackendClient();
  st.setBackend({ status: 'connecting', lastError: undefined });
  try {
    await c.health(st.backend.url);
  } catch (e) {
    st.setBackend({ status: 'error', lastError: String(e) });
    throw e;
  }
  const params: GenerationParams = st.params;
  c.connect(st.backend.url, st.backend.token, {
    engineId: st.backend.engineId === 'local-js' ? 'py-markov' : st.backend.engineId,
    seed: params.seed,
    params,
  });
}

export function disconnectBackend(): void {
  getBackendClient().disconnect();
  useStore.getState().setBackend({ status: 'disconnected', activeSource: undefined });
  failover?.bindRemoteConnected(false);
}

export function isPythonMode(): boolean {
  return useStore.getState().backend.mode === 'python';
}

/** Reset backend UI fields when switching to browser-only */
export function disablePythonMode(): void {
  disconnectBackend();
  useStore.getState().setBackend({
    mode: 'browser',
    status: 'disabled',
    engineId: DEFAULT_BROWSER_ENGINE_ID,
    engines: listBrowserEngines(),
  });
}

export function defaultHelloParams(): GenerationParams {
  return { ...DEFAULT_PARAMS, ...useStore.getState().params };
}
