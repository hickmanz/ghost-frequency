import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from './services/store';
import { loadLast, loadTuning, startPersistence, startTuningPersistence } from './services/presets';
import { setController } from './services/controller';
import { setVisualizerSource } from './ui/visualizerSource';
import { setLabSource } from './ui/labSource';
import { setFeedSource } from './ui/feedSource';
import { createRenderer } from './audio/toneRenderer';
import { Conductor } from './engines/conductor';
import { createEngineFactory } from './services/backendService';
import { loadBackend, startBackendPersistence } from './services/backendPersist';
import { listBrowserEngines, normalizeBrowserEngineId } from './engines/registry';
import { App } from './ui/App';
import './styles/global.css';

// Restore last-used params/mixer (validated + clamped) BEFORE anything subscribes to the store,
// so the Conductor starts from the user's previous settings.
const last = loadLast();
if (last) useStore.getState().replaceAll(last.params, last.mixer);

// Restore Sound Lab tuning (per-mood overrides) the same way, before the Conductor reads the store.
const savedTuning = loadTuning();
if (savedTuning) useStore.getState().replaceTuning(savedTuning);

const savedBackend = loadBackend();
if (savedBackend) {
  const mode = savedBackend.mode === 'python' ? 'python' : 'browser';
  useStore.getState().setBackend({
    ...savedBackend,
    mode,
    engineId:
      mode === 'browser'
        ? normalizeBrowserEngineId(savedBackend.engineId ?? 'local-js')
        : (savedBackend.engineId ?? 'py-markov'),
    engines: mode === 'browser' ? listBrowserEngines() : useStore.getState().backend.engines,
  });
}

// Persist params/mixer and tuning to localStorage (debounced 500ms) and flush on tab close.
const persistence = startPersistence(useStore);
const tuningPersistence = startTuningPersistence(useStore);
const backendPersistence = startBackendPersistence(useStore);
window.addEventListener('pagehide', () => {
  persistence.flush();
  tuningPersistence.flush();
  backendPersistence.flush();
});

// Playback wiring: engine (composition) -> Conductor -> renderer (Tone.js). UI only sees the controller + store.
const renderer = createRenderer();
const conductor = new Conductor(renderer, createEngineFactory());
setController(conductor);
setFeedSource({
  getBeat: () => renderer.getBeat(),
  getBpmAt: (beat) => conductor.feed.getBpmAt(beat),
  forEachEvent: (from, to, cb) => conductor.feed.forEachEvent(from, to, cb),
  getSections: () => conductor.feed.getSections(),
});
setLabSource({
  setMonitorLayer: (l) => renderer.setMonitorLayer(l),
  getMonitorWaveform: () => renderer.getMonitorWaveform(),
  getMonitorSpectrum: () => renderer.getMonitorSpectrum(),
  getLayerLevels: () => renderer.getLayerLevels(),
  getSampleRate: () => renderer.getSampleRate(),
  getComposerLiveParam: (key) => renderer.getComposerLiveParam(key),
  getComposerFilterOpenness: (layer) => renderer.getComposerFilterOpenness(layer),
  getComposerLiveVersion: () => renderer.getComposerLiveVersion(),
});
setVisualizerSource({
  getSpectrum: () => renderer.getSpectrum(),
  getLevel: () => renderer.getLevel(),
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
