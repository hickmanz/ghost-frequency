import { useEffect } from 'react';

import { useStore } from '../services/store';

import { SoundLab, SoundLabButton } from './SoundLab';

import { StartOverlay } from './StartOverlay';

import { VisualizerHost } from './VisualizerHost';

import { Deck } from './Deck';

import { LabPanels } from './Panels';

import { AdvancedDrawer } from './AdvancedDrawer';

import { togglePlayback, useUiState } from './uiState';

import { useVisualMode } from './visualMode';



function useSpaceHotkey(): void {

  useEffect(() => {

    const onKey = (e: KeyboardEvent) => {

      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

      if (!useStore.getState().audioReady) return;

      const t = e.target as HTMLElement | null;

      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.tagName === 'BUTTON') return;

      e.preventDefault();

      void togglePlayback();

    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);

  }, []);

}



function useLabHotkey(): void {

  useEffect(() => {

    const onKey = (e: KeyboardEvent) => {

      if (e.key === 'Escape' && useStore.getState().labOpen) {

        e.preventDefault();

        useStore.getState().setLabOpen(false);

      }

      if ((e.key === 'l' || e.key === 'L') && !e.repeat && useStore.getState().audioReady) {

        e.preventDefault();

        useStore.getState().setLabOpen(!useStore.getState().labOpen);

      }

    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);

  }, []);

}



function useVisualModeHotkey(): void {

  useEffect(() => {

    const onKey = (e: KeyboardEvent) => {

      if ((e.key === 'v' || e.key === 'V') && !e.repeat && useStore.getState().audioReady) {

        e.preventDefault();

        useVisualMode.getState().cycle(e.shiftKey ? -1 : 1);

      }

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

  useVisualModeHotkey();

  return (

    <div className="app app--vapor">

      <StartOverlay />

      <header className="header">

        <div className="header__logo">

          GHOST<span className="header__logo-accent"> FREQUENCY</span>

        </div>

        <div className="header__right">

          <SoundLabButton />

          <div className="header__hint">

            <kbd>Space</kbd> play · <kbd>L</kbd> lab · <kbd>V</kbd> visuals

          </div>

        </div>

      </header>

      <main className="main">

        <VisualizerHost />

        <Deck />

        <LabPanels />

        <AdvancedDrawer />

      </main>

      <SoundLab />

      <Toast />

    </div>

  );

}

