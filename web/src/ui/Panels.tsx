import { LAYER_IDS } from '@shared/index';
import { useStore } from '../services/store';
import { applyMod } from '../services/director/chaos';
import { Knob } from './Knob';
import { MixerFader } from './MixerFader';

function ModKnob({
  label,
  value,
  onChange,
  modKey,
  defaultValue = 0.5,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  modKey: string;
  defaultValue?: number;
}) {
  const mod = useStore((s) => s.mod[modKey as keyof typeof s.mod]);
  const pinned = !!useStore((s) => s.pins[modKey]);
  const togglePin = useStore((s) => s.togglePin);
  const live = mod !== undefined ? applyMod(value, mod) : undefined;
  return (
    <Knob
      label={label}
      value={value}
      onChange={onChange}
      defaultValue={defaultValue}
      mod={live}
      pinned={pinned}
      onTogglePin={() => togglePin(modKey)}
    />
  );
}

function TracklistPanel() {
  const history = useStore((s) => s.trackHistory);
  return (
    <div className="panel panel--tracklist">
      <h3>Tracklist</h3>
      <ol className="tracklist">
        {history.length === 0 && <li className="tracklist__empty">Songs appear as they play…</li>}
        {history.map((t) => (
          <li key={t.index}>
            <span className="tracklist__title">{t.title}</span>
            <span className="tracklist__key">{t.keyLabel}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LabPanels() {
  const steer = useStore((s) => s.steer);
  const setSteer = useStore((s) => s.setSteer);
  const tone = useStore((s) => s.tone);
  const setTone = useStore((s) => s.setTone);
  const chaos = useStore((s) => s.chaos);
  const setChaos = useStore((s) => s.setChaos);
  const mixer = useStore((s) => s.mixer);
  const setMixer = useStore((s) => s.setMixerLevel);
  const params = useStore((s) => s.params);
  const setParams = useStore((s) => s.setParams);

  return (
    <div className="panels-layout">
    <div className="grid grid--lab">
      <div className="panel panel--form">
        <h3>Form</h3>
        <div className="panel__knobs">
          <ModKnob label="Pace" modKey="pace" value={steer.pace} onChange={(v) => setSteer({ pace: v })} />
          <ModKnob label="Build" modKey="build" value={steer.build} onChange={(v) => setSteer({ build: v })} />
          <ModKnob label="Energy" modKey="energy" value={params.energy} onChange={(v) => setParams({ energy: v })} />
          <ModKnob label="Contrast" modKey="contrast" value={params.contrast ?? 0.5} onChange={(v) => setParams({ contrast: v })} />
        </div>
      </div>
      <div className="panel panel--harmony">
        <h3>Harmony</h3>
        <div className="panel__knobs">
          <ModKnob label="Motion" modKey="motion" value={steer.motion} onChange={(v) => setSteer({ motion: v })} />
          <ModKnob label="Colour" modKey="colour" value={steer.colour} onChange={(v) => setSteer({ colour: v })} />
          <ModKnob label="Complex" modKey="complexity" value={params.complexity} onChange={(v) => setParams({ complexity: v })} />
          <ModKnob label="Variation" modKey="variation" value={params.variation} onChange={(v) => setParams({ variation: v })} />
        </div>
      </div>
      <div className="panel panel--rhythm">
        <h3>Rhythm</h3>
        <div className="panel__knobs">
          <ModKnob label="Swing" modKey="swing" value={steer.swing} onChange={(v) => setSteer({ swing: v })} />
          <ModKnob label="Busy" modKey="busy" value={steer.busy} onChange={(v) => setSteer({ busy: v })} />
          <ModKnob label="Sync" modKey="sync" value={steer.sync} onChange={(v) => setSteer({ sync: v })} />
          <ModKnob label="Feel" modKey="feel" value={steer.feel} onChange={(v) => setSteer({ feel: v })} />
        </div>
      </div>
      <div className="panel panel--melody">
        <h3>Melody</h3>
        <div className="panel__knobs">
          <ModKnob label="Lead" modKey="lead" value={steer.lead} onChange={(v) => setSteer({ lead: v })} />
          <ModKnob label="Recall" modKey="recall" value={steer.recall} onChange={(v) => setSteer({ recall: v })} />
          <ModKnob label="Register" modKey="register" value={steer.register} onChange={(v) => setSteer({ register: v })} />
        </div>
      </div>
      <div className="panel panel--tone">
        <h3>Tone</h3>
        <div className="panel__knobs">
          <ModKnob label="Bright" modKey="bright" value={tone.bright} onChange={(v) => setTone({ bright: v })} />
          <ModKnob label="Grit" modKey="grit" value={tone.grit} onChange={(v) => setTone({ grit: v })} />
          <ModKnob label="Space" modKey="space" value={tone.space} onChange={(v) => setTone({ space: v })} />
          <ModKnob label="Wow" modKey="wow" value={tone.wow} onChange={(v) => setTone({ wow: v })} />
          <ModKnob label="Crush" modKey="crush" value={tone.crush} onChange={(v) => setTone({ crush: v })} />
        </div>
      </div>
      <div className="panel panel--chaos">
        <h3>Director</h3>
        <div className="panel__knobs">
          <ModKnob label="Chaos" modKey="energy" value={chaos.amount} onChange={(v) => setChaos({ amount: v })} defaultValue={0.35} />
          <ModKnob label="Rate" modKey="variation" value={chaos.rate} onChange={(v) => setChaos({ rate: v })} defaultValue={0.4} />
        </div>
        <label className="toggle toggle--director" title="Between songs, sometimes step mood to a neighbor (unless mood is pinned)">
          <input type="checkbox" checked={chaos.stationDrift} onChange={(e) => setChaos({ stationDrift: e.target.checked })} />
          <span className="toggle__box" aria-hidden="true" />
          <span className="toggle__text">Station drift</span>
        </label>
        <div className="chips">
          {(['form', 'harmony', 'rhythm', 'melody', 'tone'] as const).map((g) => (
            <button key={g} type="button" className={`chip${chaos[g] ? ' is-on' : ''}`} onClick={() => setChaos({ [g]: !chaos[g] })}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="panel panel--mixer">
        <h3>Mixer</h3>
        <div className="faders">
          {LAYER_IDS.map((l) => (
            <MixerFader key={l} label={l} value={mixer[l]} onChange={(v) => setMixer(l, v)} />
          ))}
          <MixerFader label="master" value={mixer.master} onChange={(v) => setMixer('master', v)} className="fader--master" />
        </div>
      </div>
    </div>
    <TracklistPanel />
    </div>
  );
}
