import { MOOD_IDS } from '@shared/index';
import { useStore } from '../services/store';
import { getController } from '../services/controller';
import { randomSeed, regenerateWithSeed, togglePlayback } from './uiState';

export function Deck() {
  const playing = useStore((s) => s.playing);
  const busy = useStore((s) => s.busy);
  const now = useStore((s) => s.now);
  const mood = useStore((s) => s.params.mood);

  return (
    <section className="deck">
      <div className="deck__now">
        <div className="deck__song-title">{now.songTitle || '—'}</div>
        <div className="deck__meta">
          <span>{now.keyLabel}</span>
          <span>{now.chordLabel}</span>
          <span>{now.tempo ? `${Math.round(now.tempo)} BPM` : '—'}</span>
          <span>{now.sectionName}</span>
        </div>
        <div className="deck__progress">
          <div className="deck__progress-bar" style={{ width: `${Math.round(now.songProgress * 100)}%` }} />
        </div>
        <div className="deck__readout">
          bar {now.bar + 1}.{Math.floor(now.beatInBar) + 1}
        </div>
      </div>
      <div className="deck__transport">
        <div className="deck__actions">
          <button type="button" className="btn btn--play" disabled={busy} onClick={() => void togglePlayback()}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="btn btn--small btn--deck"
            disabled={busy}
            onClick={() => void regenerateWithSeed(randomSeed())}
            title="New random seed"
          >
            Regenerate
          </button>
          <button
            type="button"
            className="btn btn--small btn--deck"
            disabled={busy}
            onClick={() => getController().skipSong?.()}
            title="Skip to next song"
          >
            Skip song
          </button>
        </div>
        <div className="deck__moods">
          {MOOD_IDS.map((m) => (
            <button
              key={m}
              type="button"
              className={`station${m === mood ? ' is-active' : ''}`}
              onClick={() => useStore.getState().setParams({ mood: m })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
