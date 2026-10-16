import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from './services/store';
import { loadLast, loadTuning, startPersistence, startTuningPersistence } from './services/presets';
import { setController } from './services/controller';
import { setVisualizerSource } from './ui/visualizerSource';
import { setLabSource } from './ui/labSource';
import { createRenderer } from './audio/toneRenderer';
import { Conductor } from './engines/conductor';
import { createEngineFactory } from './services/backendService';
import { loadBackend, startBackendPersistence } from './services/backendPersist';
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
if (savedBackend) useStore.getState().setBackend(savedBackend);

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
setLabSource({
  setMonitorLayer: (l) => renderer.setMonitorLayer(l),
  getMonitorWaveform: () => renderer.getMonitorWaveform(),
  getMonitorSpectrum: () => renderer.getMonitorSpectrum(),
  getLayerLevels: () => renderer.getLayerLevels(),
  getSampleRate: () => renderer.getSampleRate(),
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
