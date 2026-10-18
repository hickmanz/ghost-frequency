import { DEFAULT_PARAMS, type EngineDescriptor, type GenerationParams } from '@shared/index';
import { FailoverEngine } from '../engines/failoverEngine';
import { HybridEngine } from '../engines/hybridEngine';
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
let hybrid: HybridEngine | null = null;

function descriptorFor(id: string): EngineDescriptor | undefined {
  return useStore.getState().backend.engines.find((e) => e.id === id);
}

export function getBackendClient(): BackendClient {
  if (!client) {
    client = new BackendClient({
      onMessage: (msg) => {
        if (msg.type === 'ready') {
          useStore.getState().setBackend({
            engines: [...listBrowserEngines(), ...msg.engines],
          });
        }
        if (msg.type === 'vibe') {
          const st = useStore.getState();
          st.setParams({ vibe: msg.vibe, ...(msg.mood ? { mood: msg.mood as GenerationParams['mood'] } : {}) });
        }
      },
      onStatus: (status) => {
        const st = useStore.getState();
        const map = status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : status === 'error' ? 'error' : 'disconnected';
        st.setBackend({ status: map });
        failover?.bindRemoteConnected(status === 'connected');
        hybrid?.bindRemoteConnected(status === 'connected');
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
    hybrid = new HybridEngine(remote);
  }
  return client;
}

function resolvePythonEngineId(engineId: string): string {
  const isBrowserId = listBrowserEngines().some((e) => e.id === engineId);
  if (isBrowserId || engineId === 'local-js') return 'py-markov';
  return engineId;
}

export function createEngineFactory(): () => ComposerEngine {
  return () => {
    const st = useStore.getState().backend;
    if (st.mode === 'python') {
      getBackendClient();
      const pyId = resolvePythonEngineId(st.engineId);
      const desc = descriptorFor(pyId);
      remote!.setEngineId(pyId);
      const hybridLayers = pyId === 'py-neural-layers' || desc?.mode === 'layers';
      if (hybridLayers) {
        hybrid!.setRemoteEngineId(pyId);
        hybrid!.info = {
          id: pyId,
          name: desc?.name ?? 'Neural layers (hybrid)',
          mode: 'layers',
          layers: desc?.layers ?? ['lead', 'arp', 'bass', 'drums'],
        };
        return hybrid!;
      }
      failover!.setRemoteEngineId(pyId);
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
  const pyId = resolvePythonEngineId(st.backend.engineId);
  c.connect(st.backend.url, st.backend.token, {
    engineId: pyId,
    seed: params.seed,
    params,
  });
}

export function disconnectBackend(): void {
  getBackendClient().disconnect();
  useStore.getState().setBackend({ status: 'disconnected', activeSource: undefined });
  failover?.bindRemoteConnected(false);
  hybrid?.bindRemoteConnected(false);
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

export function sendVibePrompt(text: string): void {
  getBackendClient().send({ type: 'vibe_prompt', text });
}
