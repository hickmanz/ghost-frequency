import { useState } from 'react';
import { useStore } from '../services/store';
import { errorMessage, tryGetController } from './uiState';

export function StartOverlay() {
  const audioReady = useStore((s) => s.audioReady);
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (audioReady || dismissed) return null;

  const begin = async () => {
    if (starting) return;
    setError(null);
    const c = tryGetController();
    if (!c) {
      setError('Audio engine is not ready yet. Please try again in a moment.');
      return;
    }
    setStarting(true);
    try {
      await c.play(); // must be invoked from this user gesture
      setDismissed(true);
    } catch (e) {
      setError(`Could not start audio: ${errorMessage(e)}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="overlay-title">
      <div className="overlay__sun" aria-hidden="true" />
      <div className="overlay__grid" aria-hidden="true" />
      <div className="overlay__content">
        <h1 id="overlay-title" className="overlay__title">
          GHOST<span className="overlay__title-accent"> FREQUENCY</span>
        </h1>
        <p className="overlay__tagline">infinite procedural synthwave &amp; ambient</p>
        <button type="button" className="overlay__button" onClick={begin} disabled={starting} autoFocus>
          {starting ? 'Initialising audio...' : 'Click to begin'}
        </button>
        {error && (
          <p className="overlay__error" role="alert">
            {error}
          </p>
        )}
        <p className="overlay__hint">Headphones recommended</p>
      </div>
    </div>
  );
}
