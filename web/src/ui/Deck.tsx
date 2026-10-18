import { Loader2, Pause, Play, RotateCw, SkipForward } from 'lucide-react';
import { MOOD_IDS } from '@shared/index';
import { useStore } from '../services/store';
import { getController } from '../services/controller';
import { primeAudioUnlock } from '../audio/mobileAudio';
import { randomSeed, regenerateWithSeed, togglePlayback } from './uiState';
import { SoundLabButton } from './SoundLab';
import { MOOD_STATION_HINTS } from './controlHints';
import { STATIONS } from './stations';

const DECK_ICON = { size: 20, strokeWidth: 2 } as const;
const STATION_ICON = { size: 16, strokeWidth: 2 } as const;

export function Deck() {
  const playing = useStore((s) => s.playing);
  const busy = useStore((s) => s.busy);
  const now = useStore((s) => s.now);
  const mood = useStore((s) => s.params.mood);

  return (
    <section className="deck">
      <div className="deck__upper">
        <div className="deck__now">
          <div className="deck__song-title">{now.songTitle || '—'}</div>
          <div className="deck__meta">
            <span>{now.keyLabel}</span>
            <span>{now.chordLabel}</span>
            <span>{now.tempo ? `${Math.round(now.tempo)} BPM` : '—'}</span>
            <span>{now.sectionName}</span>
          </div>
          <div className="deck__progress-row">
            <div className="deck__progress">
              <div className="deck__progress-bar" style={{ width: `${Math.round(now.songProgress * 100)}%` }} />
            </div>
            <div className="deck__readout">
              bar {now.bar + 1}.{Math.floor(now.beatInBar) + 1}
            </div>
          </div>
        </div>
        <div className="deck__actions">
          <button
            type="button"
            className={`btn btn--play btn--icon${playing ? ' is-active' : ''}`}
            disabled={busy}
            aria-pressed={playing}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onPointerDown={primeAudioUnlock}
            onClick={() => void togglePlayback()}
          >
            <span className="btn__icon" aria-hidden="true">
              {playing ? <Pause {...DECK_ICON} /> : <Play {...DECK_ICON} />}
            </span>
          </button>
          <button
            type="button"
            className={`btn btn--small btn--secondary btn--icon${busy ? ' is-busy' : ''}`}
            disabled={busy}
            aria-busy={busy}
            aria-label={busy ? 'Composing' : 'Regenerate'}
            title="New random seed"
            onClick={() => void regenerateWithSeed(randomSeed())}
          >
            <span className="btn__icon" aria-hidden="true">
              {busy ? <Loader2 {...DECK_ICON} /> : <RotateCw {...DECK_ICON} />}
            </span>
          </button>
          <button
            type="button"
            className="btn btn--small btn--secondary btn--icon"
            disabled={busy}
            aria-label="Skip to next song"
            title="Skip to next song"
            onClick={() => getController().skipSong?.()}
          >
            <span className="btn__icon" aria-hidden="true">
              <SkipForward {...DECK_ICON} />
            </span>
          </button>
        </div>
      </div>
      <div className="deck__stations">
        <p className="deck__stations-label">Station</p>
        <div className="deck__stations-row">
          <div className="deck__stations-moods" role="group" aria-label="Mood station">
            {MOOD_IDS.map((m) => {
              const { label, Icon } = STATIONS[m];
              return (
                <button
                  key={m}
                  type="button"
                  className={`station station--deck${m === mood ? ' is-active' : ''}`}
                  aria-pressed={m === mood}
                  title={MOOD_STATION_HINTS[m]}
                  onClick={() => useStore.getState().setParams({ mood: m })}
                >
                  <Icon {...STATION_ICON} aria-hidden="true" className="station__icon" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <SoundLabButton />
        </div>
      </div>
    </section>
  );
}
