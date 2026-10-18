import { Visualizer } from './Visualizer';
import { createLandscapeScene, LANDSCAPE_OPTIONS } from './visual/landscape';
import { createSpectrogramScene, SPECTROGRAM_OPTIONS } from './visual/spectrogram';
import { createTimelineScene, TIMELINE_OPTIONS } from './visual/timeline';
import { VisualCanvas } from './visual/VisualCanvas';
import { VISUAL_MODE_HINTS } from './controlHints';
import { VISUAL_MODES, VISUAL_MODE_LABEL, useVisualMode, type VisualMode } from './visualMode';

function ModeView({ mode }: { mode: VisualMode }) {
  switch (mode) {
    case 'landscape':
      return (
        <VisualCanvas
          factory={createLandscapeScene}
          options={LANDSCAPE_OPTIONS}
          label="Mood-reactive synthwave landscape"
          title
        />
      );
    case 'spectrogram':
      return (
        <VisualCanvas
          factory={createSpectrogramScene}
          options={SPECTROGRAM_OPTIONS}
          label="Scrolling spectrogram"
        />
      );
    case 'timeline':
      return (
        <VisualCanvas
          factory={createTimelineScene}
          options={TIMELINE_OPTIONS}
          label="Song structure timeline"
        />
      );
    default:
      return <Visualizer />;
  }
}

/** Main-screen visual: segmented mode switch + the active mode (inactive modes are unmounted so their rAF loops stop). */
export function VisualizerHost() {
  const mode = useVisualMode((s) => s.mode);
  const setMode = useVisualMode((s) => s.setMode);
  return (
    <div className="vhost">
      <ModeView key={mode} mode={mode} />
      <div className="vhost__bar">
        <span className="vhost__hint" aria-hidden="true">
          Visuals <kbd>V</kbd>
        </span>
        <div className="vhost__modes" role="radiogroup" aria-label="Visual mode (V to cycle)" title="Visual mode (V to cycle)">
          {VISUAL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              className={m === mode ? 'vhost__mode is-active' : 'vhost__mode'}
              title={VISUAL_MODE_HINTS[m]}
              onClick={() => setMode(m)}
            >
              {VISUAL_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
