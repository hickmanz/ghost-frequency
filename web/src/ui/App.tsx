import { useEffect } from 'react';
import { useStore } from '../services/store';
import { BackendPanel } from './BackendPanel';
import { GenerationPanel } from './GenerationPanel';
import { MixerPanel } from './MixerPanel';
import { PresetsPanel } from './PresetsPanel';
import { SoundLab, SoundLabButton } from './SoundLab';
import { StartOverlay } from './StartOverlay';
import { Transport } from './Transport';
import { Visualizer } from './Visualizer';
import { togglePlayback, useUiState } from './uiState';

/** Space toggles playback unless the user is interacting with a form control / button. */
function useSpaceHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!useStore.getState().audioReady) return; // start overlay owns the keyboard until then
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          tag === 'BUTTON' ||
          tag === 'A' ||
          t.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      void togglePlayback();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** 'L' toggles the Sound Lab (not while typing / dragging a control); Esc closes it. */
function useLabHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useStore.getState();
      if (e.key === 'Escape') {
        if (st.labOpen) {
          e.preventDefault();
          st.setLabOpen(false);
        }
        return;
      }
      if ((e.key !== 'l' && e.key !== 'L') || e.repeat) return;
      if (!st.audioReady) return; // start overlay owns the keyboard until then
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        const isRange = tag === 'INPUT' && (t as HTMLInputElement).type === 'range';
        if ((tag === 'INPUT' && !isRange) || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      e.preventDefault();
      st.setLabOpen(!st.labOpen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Toast() {
  const notice = useUiState((s) => s.notice);
  const dismiss = useUiState((s) => s.dismiss);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, notice.kind === 'error' ? 6000 : 2800);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  if (!notice) return null;
  return (
    <div className={`toast toast--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} onClick={dismiss}>
      {notice.text}
    </div>
  );
}

export function App() {
  useSpaceHotkey();
  useLabHotkey();
  return (
    <div className="app">
      <StartOverlay />
      <header className="header">
        <div className="header__logo">
          GHOST<span className="header__logo-accent"> FREQUENCY</span>
        </div>
        <div className="header__right">
          <SoundLabButton />
          <div className="header__hint">
            <kbd>Space</kbd> play / pause
          </div>
        </div>
      </header>
      <main className="main">
        <Visualizer />
        <Transport />
        <div className="main__grid">
          <GenerationPanel />
          <MixerPanel />
          <div className="main__side">
            <BackendPanel />
            <PresetsPanel />
          </div>
        </div>
      </main>
      <SoundLab />
      <Toast />
    </div>
  );
}
