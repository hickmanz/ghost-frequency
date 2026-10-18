import { memo } from 'react';
import { LAYER_IDS, type LayerId } from '@shared/index';
import { useStore } from '../services/store';
import { hintForMixer } from './controlHints';
import { Slider } from './Slider';

const LABELS: Record<LayerId | 'master', string> = {
  pad: 'Pad',
  arp: 'Arp',
  bass: 'Bass',
  lead: 'Lead',
  drums: 'Percussion',
  texture: 'Ambient',
  bell: 'Bell',
  master: 'Master',
};

const ACCENTS: Record<LayerId | 'master', 'cyan' | 'magenta' | 'violet'> = {
  pad: 'violet',
  arp: 'cyan',
  bass: 'magenta',
  lead: 'cyan',
  drums: 'magenta',
  texture: 'violet',
  bell: 'cyan',
  master: 'magenta',
};

const Fader = memo(function Fader({ id }: { id: LayerId | 'master' }) {
  const value = useStore((s) => s.mixer[id]);
  const setLevel = useStore((s) => s.setMixerLevel);
  return (
    <Slider
      label={LABELS[id]}
      title={hintForMixer(id)}
      value={value}
      variant="mixer"
      accent={ACCENTS[id]}
      onChange={(v) => setLevel(id, v)}
    />
  );
});

export function MixerPanel() {
  return (
    <section className="panel mixer" aria-labelledby="mix-title">
      <h2 id="mix-title" className="panel__title">
        Mixer
      </h2>
      <div className="mixer__faders">
        {LAYER_IDS.map((id) => (
          <Fader key={id} id={id} />
        ))}
      </div>
      <div className="mixer__master">
        <Fader id="master" />
      </div>
    </section>
  );
}
