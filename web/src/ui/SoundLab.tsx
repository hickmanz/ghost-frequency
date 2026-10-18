import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { LayerId, MoodId } from '@shared/index';
import { useStore } from '../services/store';
import { TUNING_SCHEMA, type TuningGroup, type TuningGroupId, type TuningParam } from '../tuning/schema';
import { formatOverridesForCopy, getDefaultValue } from '../tuning/defaults';
import { copyText } from './clipboard';
import { buildSections, findOption, levelToMeter, waveGlyphPoints, type WaveKind } from './labMath';
import { getLabSource } from './labSource';
import {
  FRAC_HALF,
  FRAC_TALL,
  beginParamDrag,
  clampFrac,
  clearParamFocus,
  focusParam,
  hoverParam,
  useLabUi,
} from './labState';
import { LabVisuals } from './LabVisuals';
import {
  formatValue,
  isModified,
  resolveValue,
  sliderSteps,
  sliderToValue,
  valueToNorm,
  valueToOverride,
  valueToSlider,
} from './tuningMath';
import { notify, togglePlayback } from './uiState';
import { smoothValue } from './visualizerMath';

const MOOD_LABEL: Record<MoodId, string> = {
  dreamy: 'Dreamy',
  dark: 'Dark',
  nostalgic: 'Nostalgic',
  space: 'Space Ambient',
};

const GROUP_LABEL: Record<string, string> = {
  pad: 'Pad',
  arp: 'Arpeggio',
  bass: 'Bass',
  lead: 'Lead',
  drums: 'Percussion',
  texture: 'Ambient',
  fx: 'Space / FX',
};

const TAB_ORDER: readonly string[] = ['pad', 'arp', 'bass', 'lead', 'drums', 'texture', 'fx'];

function groupLabel(id: string, fallback: string): string {
  return GROUP_LABEL[id] ?? fallback;
}

function orderGroups(groups: readonly TuningGroup[]): TuningGroup[] {
  const rank = (id: string) => {
    const i = TAB_ORDER.indexOf(id);
    return i < 0 ? TAB_ORDER.length : i;
  };
  return [...groups].sort((a, b) => rank(a.id) - rank(b.id));
}

function isLayerGroup(id: TuningGroupId): id is LayerId {
  return id !== 'fx';
}

// ---------------------------------------------------------------------------------------------
// header button
// ---------------------------------------------------------------------------------------------

export function SoundLabButton() {
  const open = useStore((s) => s.labOpen);
  const setLabOpen = useStore((s) => s.setLabOpen);
  return (
    <button
      type="button"
      className={`btn btn--small btn--secondary lab-toggle${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-controls="sound-lab"
      onClick={() => setLabOpen(!open)}
      title="Sound Lab: tune instrument sounds by ear (L)"
    >
      <span className="btn__icon" aria-hidden="true">
        {'\u2699'}
      </span>
      <span>Sound Lab</span>
      <kbd>L</kbd>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// wave glyph (tiny analytic SVG)
// ---------------------------------------------------------------------------------------------

const GLYPH_W = 36;
const GLYPH_H = 16;

const WaveGlyph = memo(function WaveGlyph({ wave, fat }: { wave: WaveKind; fat: boolean }) {
  const main = useMemo(() => waveGlyphPoints(wave, GLYPH_W, GLYPH_H), [wave]);
  const a = useMemo(() => (fat ? waveGlyphPoints(wave, GLYPH_W, GLYPH_H, 0.86) : ''), [wave, fat]);
  const b = useMemo(() => (fat ? waveGlyphPoints(wave, GLYPH_W, GLYPH_H, 1.14) : ''), [wave, fat]);
  return (
    <svg className="lab-glyph" width={GLYPH_W} height={GLYPH_H} viewBox={`0 0 ${GLYPH_W} ${GLYPH_H}`} aria-hidden="true" focusable="false">
      {fat && <polyline className="lab-glyph__ghost" points={a} />}
      {fat && <polyline className="lab-glyph__ghost" points={b} />}
      <polyline className="lab-glyph__line" points={main} />
    </svg>
  );
});

// ---------------------------------------------------------------------------------------------
// parameter rows (each subscribes only to its own override value)
// ---------------------------------------------------------------------------------------------

function useRowHandlers(key: string) {
  return useMemo(
    () => ({
      onPointerEnter: () => hoverParam(key),
      onPointerLeave: () => hoverParam(null),
      onFocus: () => focusParam(key),
      onBlur: () => focusParam(null),
      onPointerDown: () => beginParamDrag(key),
    }),
    [key],
  );
}

const SliderRow = memo(function SliderRow({ param, mood }: { param: TuningParam; mood: MoodId }) {
  const override = useStore((s) => s.tuning[mood]?.[param.key]);
  const def = useMemo(() => getDefaultValue(mood, param.key), [mood, param.key]);
  const value = resolveValue(param, override, def);
  const modified = isModified(param, override, def);
  const steps = sliderSteps(param);
  const pos = valueToSlider(param, value);
  const handlers = useRowHandlers(param.key);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = valueToOverride(param, sliderToValue(param, Number(e.currentTarget.value)), def);
      const st = useStore.getState();
      if (st.tuning[mood]?.[param.key] === next) return;
      st.setTuningValue(mood, param.key, next);
    },
    [param, mood, def],
  );

  const reset = useCallback(() => {
    useStore.getState().setTuningValue(mood, param.key, undefined);
  }, [mood, param.key]);

  const style = {
    '--pct': `${(pos / steps) * 100}%`,
    '--def': def === undefined ? '-10%' : `${valueToNorm(param, def) * 100}%`,
  } as CSSProperties;
  const text = formatValue(param, value);
  const inputId = `lab-${param.key}`;
  const hintId = `${inputId}-hint`;

  return (
    <div className={`lab-row${modified ? ' is-modified' : ''}`} {...handlers}>
      <div className="lab-row__head">
        <label className="lab-row__label" htmlFor={inputId} title={param.hint}>
          {modified && <span className="lab-row__dot" aria-hidden="true" title="Changed from default" />}
          <span className="lab-row__name">{param.label}</span>
        </label>
        <output className="lab-row__value" htmlFor={inputId}>
          {text}
        </output>
        <button
          type="button"
          className="lab-row__reset"
          onClick={reset}
          disabled={!modified}
          aria-label={`Reset ${param.label} to default`}
          title="Reset to default"
        >
          {'\u21ba'}
        </button>
      </div>
      <div className="lab-row__track" style={style}>
        <input
          id={inputId}
          className="slider__input lab-row__input"
          type="range"
          min={0}
          max={steps}
          step={1}
          value={pos}
          aria-label={`${param.label}${modified ? ' (changed)' : ''}`}
          aria-valuetext={text}
          aria-describedby={hintId}
          title="Double-click to reset"
          onChange={onChange}
          onDoubleClick={reset}
        />
      </div>
      <p className="lab-row__hint" id={hintId} title={param.hint}>
        {param.hint}
      </p>
    </div>
  );
});

const ChoiceRow = memo(function ChoiceRow({ param, mood }: { param: TuningParam; mood: MoodId }) {
  const override = useStore((s) => s.tuning[mood]?.[param.key]);
  const def = useMemo(() => getDefaultValue(mood, param.key), [mood, param.key]);
  const options = param.options ?? [];
  const value = override ?? def ?? options[0]?.value ?? param.min;
  const selected = findOption(param, value);
  const modified = override !== undefined && (def === undefined || Math.abs(override - def) > 1e-6);
  const handlers = useRowHandlers(param.key);
  const groupRef = useRef<HTMLDivElement>(null);
  const hintId = `lab-${param.key}-hint`;

  const select = useCallback(
    (v: number) => {
      const next = def !== undefined && Math.abs(v - def) < 1e-6 ? undefined : v;
      const st = useStore.getState();
      if (st.tuning[mood]?.[param.key] === next) return;
      st.setTuningValue(mood, param.key, next);
    },
    [mood, param.key, def],
  );

  const reset = useCallback(() => {
    useStore.getState().setTuningValue(mood, param.key, undefined);
  }, [mood, param.key]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (options.length === 0) return;
      const cur = Math.max(0, options.findIndex((o) => o === selected));
      let next = cur;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (cur + 1) % options.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (cur - 1 + options.length) % options.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = options.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      select(options[next]!.value);
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
    },
    [options, selected, select],
  );

  return (
    <div className={`lab-row lab-row--choice${modified ? ' is-modified' : ''}`} {...handlers}>
      <div className="lab-row__head">
        <span className="lab-row__label" id={`lab-${param.key}-label`} title={param.hint}>
          {modified && <span className="lab-row__dot" aria-hidden="true" title="Changed from default" />}
          <span className="lab-row__name">{param.label}</span>
        </span>
        <output className="lab-row__value">{selected?.label ?? '-'}</output>
        <button
          type="button"
          className="lab-row__reset"
          onClick={reset}
          disabled={!modified}
          aria-label={`Reset ${param.label} to default`}
          title="Reset to default"
        >
          {'\u21ba'}
        </button>
      </div>
      <div
        className="lab-seg"
        role="radiogroup"
        aria-labelledby={`lab-${param.key}-label`}
        aria-describedby={hintId}
        ref={groupRef}
        onKeyDown={onKeyDown}
      >
        {options.map((o) => {
          const on = o === selected;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={`lab-seg__btn${on ? ' is-on' : ''}`}
              title={`${o.label}${on ? ' (selected)' : ''}`}
              onClick={() => select(o.value)}
            >
              {o.wave ? <WaveGlyph wave={o.wave} fat={o.fat === true} /> : null}
              <span className="lab-seg__label">{o.label}</span>
            </button>
          );
        })}
      </div>
      <p className="lab-row__hint" id={hintId} title={param.hint}>
        {param.hint}
      </p>
    </div>
  );
});

const ParamRow = memo(function ParamRow({ param, mood }: { param: TuningParam; mood: MoodId }) {
  return param.kind === 'choice' && param.options && param.options.length > 0 ? (
    <ChoiceRow param={param} mood={mood} />
  ) : (
    <SliderRow param={param} mood={mood} />
  );
});

// ---------------------------------------------------------------------------------------------
// instrument tabs (left): select + solo / mute + live meter
// ---------------------------------------------------------------------------------------------

const LayerButtons = memo(function LayerButtons({ layer, label }: { layer: LayerId; label: string }) {
  const soloed = useStore((s) => s.solo === layer);
  const muted = useStore((s) => s.muted[layer] === true);
  return (
    <span className="lab-tab__buttons">
      <button
        type="button"
        className={`lab-btn lab-btn--solo${soloed ? ' is-on' : ''}`}
        aria-pressed={soloed}
        aria-label={`Solo ${label}`}
        title={soloed ? `Stop soloing ${label}` : `Hear only ${label}`}
        onClick={() => {
          const st = useStore.getState();
          st.setSolo(st.solo === layer ? null : layer);
          if (st.solo !== layer) useLabUi.getState().setGroup(layer);
        }}
      >
        S
      </button>
      <button
        type="button"
        className={`lab-btn lab-btn--mute${muted ? ' is-on' : ''}`}
        aria-pressed={muted}
        aria-label={`Mute ${label}`}
        title={muted ? `Unmute ${label}` : `Silence ${label}`}
        onClick={() => {
          const st = useStore.getState();
          st.setMuted(layer, st.muted[layer] !== true);
        }}
      >
        M
      </button>
    </span>
  );
});

const LayerTab = memo(function LayerTab({
  group,
  mood,
  active,
  registerMeter,
}: {
  group: TuningGroup;
  mood: MoodId;
  active: boolean;
  registerMeter(id: string, el: HTMLElement | null): void;
}) {
  const soloed = useStore((s) => s.solo === group.id);
  const muted = useStore((s) => s.muted[group.id as LayerId] === true);
  const dimmed = useStore((s) => s.solo !== null && s.solo !== group.id && group.id !== 'fx');
  const changed = useStore((s) => {
    const o = s.tuning[mood];
    if (!o) return 0;
    let n = 0;
    for (const p of group.params) if (o[p.key] !== undefined) n++;
    return n;
  });
  const label = groupLabel(group.id, group.label);
  const layer = isLayerGroup(group.id) ? group.id : null;
  return (
    <div
      role="presentation"
      className={`lab-tab lab-tab--${group.id}${active ? ' is-active' : ''}${soloed ? ' is-solo' : ''}${muted ? ' is-muted' : ''}${dimmed ? ' is-dimmed' : ''}`}
    >
      <button
        type="button"
        role="tab"
        id={`lab-tab-${group.id}`}
        data-tab={group.id}
        aria-selected={active}
        aria-controls="lab-panel"
        tabIndex={active ? 0 : -1}
        className="lab-tab__main"
        onClick={() => useLabUi.getState().setGroup(group.id)}
        title={`Tune ${label}`}
      >
        <span className="lab-tab__name">{label}</span>
        {changed > 0 && (
          <span className="lab-tab__changed" title={`${changed} changed`} aria-label={`${changed} changed`}>
            {changed}
          </span>
        )}
        {layer && (
          <span className="lab-meter" aria-hidden="true">
            <i className="lab-meter__fill" ref={(el) => registerMeter(group.id, el)} />
          </span>
        )}
      </button>
      {layer && <LayerButtons layer={layer} label={label} />}
    </div>
  );
});

const COMPACT_LAB_MQ = '(max-width: 760px)';

function useCompactLabLayout(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(COMPACT_LAB_MQ).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_LAB_MQ);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return compact;
}

const LayerTabs = memo(function LayerTabs({ groups, mood, activeId }: { groups: readonly TuningGroup[]; mood: MoodId; activeId: string }) {
  const compact = useCompactLabLayout();
  const meters = useRef(new Map<string, HTMLElement>());
  const registerMeter = useCallback((id: string, el: HTMLElement | null) => {
    if (el) meters.current.set(id, el);
    else meters.current.delete(id);
  }, []);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact) return;
    const tab = listRef.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`)?.closest('.lab-tab');
    tab?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeId, compact]);

  // one rAF loop for all meters; only runs while mounted (dock open) and the tab is visible
  useEffect(() => {
    const ids = groups.filter((g) => isLayerGroup(g.id)).map((g) => g.id as LayerId);
    const smooth = new Float32Array(ids.length);
    const shown = new Float32Array(ids.length).fill(-1);
    let raf = 0;
    let last = 0;
    let lastDraw = 0;
    let running = false;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - lastDraw < 32) return;
      lastDraw = t;
      const dt = last === 0 ? 16 : Math.min(100, t - last);
      last = t;
      const src = getLabSource();
      const levels = src ? src.getLayerLevels() : null;
      for (let i = 0; i < ids.length; i++) {
        const target = levels ? levelToMeter(levels[ids[i]!] ?? 0) : 0;
        const v = smoothValue(smooth[i]!, target, dt, 30, 300);
        smooth[i] = v;
        if (Math.abs(v - shown[i]!) > 0.006 || (v === 0 && shown[i] !== 0)) {
          shown[i] = v;
          const el = meters.current.get(ids[i]!);
          if (el) el.style.transform = `scaleX(${v.toFixed(3)})`;
        }
      }
    };
    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [groups]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const cur = groups.findIndex((g) => g.id === activeId);
      let next = cur;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (cur + 1) % groups.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (cur - 1 + groups.length) % groups.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = groups.length - 1;
      else return;
      e.preventDefault();
      const id = groups[next]!.id;
      useLabUi.getState().setGroup(id);
      listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
    },
    [groups, activeId],
  );

  return (
    <nav className="lab-tabs" aria-label="Instruments">
      <div
        className="lab-tabs__list"
        role="tablist"
        aria-orientation={compact ? 'horizontal' : 'vertical'}
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {groups.map((g) => (
          <LayerTab key={g.id} group={g} mood={mood} active={g.id === activeId} registerMeter={registerMeter} />
        ))}
      </div>
      <SoloBanner />
    </nav>
  );
});

function SoloBanner() {
  const solo = useStore((s) => s.solo);
  const setSolo = useStore((s) => s.setSolo);
  if (!solo) return null;
  return (
    <button type="button" className="lab-banner" onClick={() => setSolo(null)} title="Hear everything again">
      Soloing {groupLabel(solo, solo)} - clear
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// center: the selected group's controls
// ---------------------------------------------------------------------------------------------

function Hearing({ group }: { group: TuningGroup }) {
  const solo = useStore((s) => s.solo);
  const muted = useStore((s) => (isLayerGroup(group.id) ? s.muted[group.id] === true : false));
  const label = groupLabel(group.id, group.label);
  let state: string;
  let cls = '';
  if (!isLayerGroup(group.id)) {
    state = 'shapes the whole mix';
  } else if (solo === group.id) {
    state = 'soloed - you hear only this';
    cls = ' is-solo';
  } else if (solo !== null) {
    state = `silent - ${groupLabel(solo, solo)} is soloed`;
    cls = ' is-silent';
  } else if (muted) {
    state = 'muted';
    cls = ' is-silent';
  } else {
    state = 'playing in the mix';
  }
  return (
    <p className={`lab-hearing${cls}`} aria-live="polite">
      <span className="lab-hearing__label">Hearing</span> <strong>{label}</strong> <span className="lab-hearing__state">{state}</span>
    </p>
  );
}

const GroupPanel = memo(function GroupPanel({ group, mood }: { group: TuningGroup; mood: MoodId }) {
  const sections = useMemo(() => buildSections(group.params), [group]);
  const changed = useStore((s) => {
    const o = s.tuning[mood];
    if (!o) return 0;
    let n = 0;
    for (const p of group.params) if (o[p.key] !== undefined) n++;
    return n;
  });

  const resetGroup = useCallback(() => {
    const st = useStore.getState();
    const cur = st.tuning[mood];
    if (!cur) return;
    const drop = new Set(group.params.map((p) => p.key));
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(cur)) if (!drop.has(k)) next[k] = v;
    st.replaceTuning({ ...st.tuning, [mood]: next });
  }, [group, mood]);

  return (
    <section className="lab-main" id="lab-panel" role="tabpanel" aria-labelledby={`lab-tab-${group.id}`}>
      <div className="lab-main__head">
        <Hearing group={group} />
        <span className="lab-main__count">{changed > 0 ? `${changed} changed` : 'defaults'}</span>
        <button type="button" className="lab-link" onClick={resetGroup} disabled={changed === 0}>
          Reset {groupLabel(group.id, group.label)}
        </button>
      </div>
      <div className="lab-main__scroll">
        <div className="lab-params">
          {sections.map((sec) => (
            <div className={`lab-sec lab-sec--${sec.id}`} key={sec.id}>
              <h4 className="lab-sec__title">{sec.label}</h4>
              {sec.params.map((p) => (
                <ParamRow key={p.key} param={p} mood={mood} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------------------------
// dock chrome: drag handle + header
// ---------------------------------------------------------------------------------------------

function setDockFrac(f: number): void {
  document.documentElement.style.setProperty('--lab-frac', String(f));
}

function DockHandle() {
  const frac = useLabUi((s) => s.frac);
  const drag = useRef<{ y: number; frac: number; moved: boolean; cur: number } | null>(null);

  const toggle = () => {
    const f = useLabUi.getState().frac;
    useLabUi.getState().setFrac(f > (FRAC_HALF + FRAC_TALL) / 2 ? FRAC_HALF : FRAC_TALL);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = useLabUi.getState().frac;
    drag.current = { y: e.clientY, frac: f, moved: false, cur: f };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (!d.moved) return;
    d.cur = clampFrac(d.frac + (d.y - e.clientY) / Math.max(1, window.innerHeight));
    setDockFrac(d.cur);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) useLabUi.getState().setFrac(d.cur);
    else toggle();
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const st = useLabUi.getState();
    if (e.key === 'ArrowUp') st.setFrac(st.frac + 0.05);
    else if (e.key === 'ArrowDown') st.setFrac(st.frac - 0.05);
    else if (e.key === 'Enter' || e.key === ' ') toggle();
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="lab-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize Sound Lab: drag, click to switch half / tall, or use the up and down arrow keys"
      aria-valuemin={30}
      aria-valuemax={92}
      aria-valuenow={Math.round(frac * 100)}
      tabIndex={0}
      title="Drag to resize, click to switch half / tall"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        setDockFrac(useLabUi.getState().frac);
      }}
      onKeyDown={onKey}
    >
      <span className="lab-handle__grip" aria-hidden="true" />
    </div>
  );
}

const LabHeader = memo(function LabHeader({ mood }: { mood: MoodId }) {
  const modifiedCount = useStore((s) => Object.keys(s.tuning[mood] ?? {}).length);
  const setLabOpen = useStore((s) => s.setLabOpen);
  const playing = useStore((s) => s.playing);
  const tall = useLabUi((s) => s.frac > (FRAC_HALF + FRAC_TALL) / 2);

  const onCopy = useCallback(async () => {
    const overrides = useStore.getState().tuning[mood] ?? {};
    if (Object.keys(overrides).length === 0) {
      notify('Nothing to copy yet - move a slider first.');
      return;
    }
    const ok = await copyText(formatOverridesForCopy(mood, overrides));
    if (ok) notify(`Copied your ${MOOD_LABEL[mood]} changes.`);
    else notify('Could not copy to the clipboard.', 'error');
  }, [mood]);

  return (
    <header className="lab-head">
      <h2 className="lab-head__title" title={`Tuning applies to ${MOOD_LABEL[mood]}. Switch mood to tune others.`}>
        Sound Lab <span className="lab-head__mood">{MOOD_LABEL[mood]}</span>
      </h2>
      <div className="lab-head__actions">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void togglePlayback()}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          <span aria-hidden="true">{playing ? '\u275a\u275a' : '\u25b6'}</span>
          <span>{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button type="button" className="btn btn--small btn--secondary" onClick={() => void onCopy()}>
          Copy changes
        </button>
        <button
          type="button"
          className="btn btn--small btn--danger"
          onClick={() => useStore.getState().resetTuning(mood)}
          disabled={modifiedCount === 0}
        >
          Reset all (this mood)
        </button>
        <span className="lab-head__count" aria-live="polite">
          {modifiedCount === 0 ? 'No changes' : `${modifiedCount} changed`}
        </span>
      </div>
      <div className="lab-head__window">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => useLabUi.getState().setFrac(tall ? FRAC_HALF : FRAC_TALL)}
          aria-label={tall ? 'Make the Sound Lab shorter' : 'Make the Sound Lab taller'}
          title={tall ? 'Shorter' : 'Taller'}
        >
          {tall ? '\u25bc' : '\u25b2'}
        </button>
        <button type="button" className="btn btn--small" onClick={() => setLabOpen(false)} aria-label="Close Sound Lab" title="Close (Esc)">
          {'\u2715'}
        </button>
      </div>
    </header>
  );
});

// ---------------------------------------------------------------------------------------------
// dock
// ---------------------------------------------------------------------------------------------

function LabDock({ groups }: { groups: readonly TuningGroup[] }) {
  const mood = useStore((s) => s.params.mood);
  const groupId = useLabUi((s) => s.group);
  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  // keep the persisted selection valid if the schema changed
  useEffect(() => {
    if (group && group.id !== groupId) useLabUi.getState().setGroup(group.id);
  }, [group, groupId]);

  // the selected instrument is the monitored layer (FX monitors nothing)
  const monitorId = group?.id ?? null;
  useEffect(() => {
    const src = getLabSource();
    if (src) src.setMonitorLayer(monitorId !== null && isLayerGroup(monitorId) ? monitorId : null);
    return () => {
      getLabSource()?.setMonitorLayer(null);
    };
  }, [monitorId]);

  // clear stale hover highlight when the dock closes or the group changes
  useEffect(() => {
    clearParamFocus();
    return clearParamFocus;
  }, [groupId]);

  if (!group) {
    return (
      <div className="lab-body">
        <p className="lab-empty">No tunable parameters are available yet.</p>
      </div>
    );
  }
  return (
    <>
      <LabHeader mood={mood} />
      <div className="lab-body">
        <LayerTabs groups={groups} mood={mood} activeId={group.id} />
        <GroupPanel group={group} mood={mood} />
        <LabVisuals group={group} mood={mood} />
      </div>
    </>
  );
}

export function SoundLab() {
  const open = useStore((s) => s.labOpen);
  const frac = useLabUi((s) => s.frac);
  const groups = useMemo(() => orderGroups(TUNING_SCHEMA), []);

  // page gets bottom padding while the dock is open (CSS reads html.has-lab + --lab-frac)
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('has-lab');
    return () => {
      root.classList.remove('has-lab');
      root.style.removeProperty('--lab-frac');
    };
  }, [open]);
  useEffect(() => {
    if (open) setDockFrac(frac);
  }, [open, frac]);

  return (
    <aside id="sound-lab" className={`lab${open ? ' is-open' : ''}`} role="region" aria-label="Sound Lab" hidden={!open}>
      {open && (
        <>
          <DockHandle />
          <LabDock groups={groups} />
        </>
      )}
    </aside>
  );
}
