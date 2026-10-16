import { DEFAULT_PARAMS, type GenerationParams } from '@shared/index';
import { FailoverEngine } from '../engines/failoverEngine';
import { LocalEngine } from '../engines/localEngine';
import { RemoteEngine } from '../engines/remoteEngine';
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
            engines: [{ id: 'local-js', name: 'Built-in (JavaScript)' }, ...msg.engines],
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

export function createEngineFactory(): () => LocalEngine | FailoverEngine {
  return () => {
    const mode = useStore.getState().backend.mode;
    if (mode === 'python') {
      getBackendClient();
      const engId = useStore.getState().backend.engineId;
      remote!.setEngineId(engId === 'local-js' ? 'py-markov' : engId);
      return failover!;
    }
    return new LocalEngine();
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
    engineId: 'local-js',
    engines: [{ id: 'local-js', name: 'Built-in (JavaScript)' }],
  });
}

export function defaultHelloParams(): GenerationParams {
  return { ...DEFAULT_PARAMS, ...useStore.getState().params };
}
