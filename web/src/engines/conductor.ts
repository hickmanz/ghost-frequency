import { MOOD_IDS, type EventBatch, type LayerId, type MoodId, type SectionEvent } from '@shared/index';
import type { TuningOverrides } from '../tuning/schema';
import type { AudioRenderer } from '../audio/types';
import type { ComposerEngine } from './types';
import type { PlaybackController } from '../services/controller';
import { useStore } from '../services/store';
import { keyLabel } from '../composition/theory';
import { EventFeed } from './eventFeed';

/** How far ahead (in beats) of the audio clock we keep notes scheduled. 4 bars of 4/4. */
const LOOKAHEAD_BEATS = 16;
/** Max bars rendered per pump tick, so a stalled tab can't produce a giant blocking burst. */
const MAX_BARS_PER_TICK = 4;
/** Pump interval. Note timing never depends on this: events carry absolute beats scheduled on the audio clock. */
const PUMP_MS = 200;
/** UI read-out refresh interval. */
const NOW_MS = 100;

type Marker =
  | { beat: number; type: 'section'; ev: SectionEvent }
  | { beat: number; type: 'tempo'; tempo: number };

/**
 * Conductor: owns the generate-ahead loop between a ComposerEngine and an AudioRenderer.
 *
 *  - Two-tier lookahead: the engine plans long sections internally; the Conductor asks it for
 *    one bar at a time, ~4 bars ahead of the audio clock, always reading the CURRENT params,
 *    so slider moves are heard within a few bars. Mixer changes are applied immediately.
 *  - Display state (key/chord/section/tempo) is derived by replaying Section events once the
 *    audio clock reaches them.
 */
export class Conductor implements PlaybackController {
  private engine: ComposerEngine;
  private nextBar = 0;
  private started = false;
  private playing = false;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private nowTimer: ReturnType<typeof setInterval> | null = null;
  private markers: Marker[] = [];
  private pumping = false;
  private unsubscribe: Array<() => void> = [];
  private resetting: Promise<void> | null = null;
  /** Rolling window of generated events for main-screen visuals (history + lookahead). */
  readonly feed = new EventFeed();

  constructor(
    private readonly renderer: AudioRenderer,
    private readonly engineFactory: () => ComposerEngine,
  ) {
    this.engine = engineFactory();

    const s = useStore;
    this.unsubscribe.push(
      s.subscribe((state, prev) => {
        if (!this.started) return;
        if (state.mixer !== prev.mixer) this.renderer.setMixer(state.mixer);
        // Tuning must be applied before a mood switch so the new mood's preset already includes overrides.
        if (state.tuning !== prev.tuning) this.applyTuning(state.tuning, prev.tuning);
        if (state.params.mood !== prev.params.mood) this.renderer.setMood(state.params.mood);
        if (state.solo !== prev.solo) this.renderer.setSolo(state.solo);
        if (state.muted !== prev.muted) {
          for (const layer of Object.keys(state.muted) as LayerId[]) {
            if (state.muted[layer] !== prev.muted[layer]) this.renderer.setLayerMuted(layer, !!state.muted[layer]);
          }
        }
      }),
    );
  }

  async play(): Promise<void> {
    const st = useStore.getState();
    if (!this.started) {
      await this.renderer.start();
      this.started = true;
      this.applyTuning(st.tuning, {});
      this.renderer.setMixer(st.mixer);
      this.renderer.setMood(st.params.mood);
      this.renderer.setSolo(st.solo);
      for (const layer of Object.keys(st.muted) as LayerId[]) this.renderer.setLayerMuted(layer, !!st.muted[layer]);
      this.engine.init(st.params.seed, st.params);
      this.nextBar = 0;
      this.markers = [];
      this.feed.clear();
      useStore.getState().setAudioReady(true);
    }
    if (this.resetting) await this.resetting;
    this.pump(true); // pre-fill before the clock starts
    this.renderer.play();
    this.playing = true;
    useStore.getState().setPlaying(true);
    this.startTimers();
  }

  pause(): void {
    if (!this.started) return;
    this.renderer.pause();
    this.playing = false;
    useStore.getState().setPlaying(false);
    this.stopPump();
  }

  async regenerate(newSeed?: number): Promise<void> {
    if (!this.started) {
      // Not initialised yet; just record the seed. play() will init from the store.
      if (newSeed !== undefined) useStore.getState().setParams({ seed: newSeed });
      return;
    }
    if (this.resetting) return this.resetting;
    this.resetting = this.doRegenerate(newSeed).finally(() => {
      this.resetting = null;
    });
    return this.resetting;
  }

  private async doRegenerate(newSeed?: number): Promise<void> {
    const store = useStore.getState();
    const wasPlaying = this.playing;
    store.setBusy(true);
    this.stopPump();
    try {
      if (newSeed !== undefined) store.setParams({ seed: newSeed });
      await this.renderer.reset();
      const params = useStore.getState().params;
      this.engine.dispose?.();
      this.engine = this.engineFactory();
      this.engine.init(params.seed, params);
      this.renderer.setMood(params.mood);
      this.nextBar = 0;
      this.markers = [];
      this.feed.clear();
      this.pump(true);
      if (wasPlaying) {
        this.renderer.play();
        this.startTimers();
      }
    } finally {
      useStore.getState().setBusy(false);
    }
  }

  async exportWav(bars: number): Promise<void> {
    const { params, mixer } = useStore.getState();
    const { exportWav } = await import('./exportWav');
    await exportWav(this.engineFactory(), params, mixer, bars);
  }

  dispose(): void {
    this.stopPump();
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.engine.dispose?.();
    this.renderer.dispose();
  }

  // ---- internals -------------------------------------------------------------------------

  private applyTuning(
    next: Partial<Record<MoodId, TuningOverrides>>,
    prev: Partial<Record<MoodId, TuningOverrides>>,
  ): void {
    for (const mood of MOOD_IDS) {
      if (next[mood] !== prev[mood]) this.renderer.setTuning(mood, next[mood] ?? {});
    }
  }

  private startTimers(): void {
    if (this.pumpTimer === null) this.pumpTimer = setInterval(() => this.pump(false), PUMP_MS);
    if (this.nowTimer === null) this.nowTimer = setInterval(() => this.updateNow(), NOW_MS);
  }

  private stopPump(): void {
    if (this.pumpTimer !== null) clearInterval(this.pumpTimer);
    if (this.nowTimer !== null) clearInterval(this.nowTimer);
    this.pumpTimer = null;
    this.nowTimer = null;
  }

  /** Render bars until we are LOOKAHEAD_BEATS ahead of the audio clock. */
  private pump(initialFill: boolean): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const params = useStore.getState().params;
      const barBeats = 4;
      const maxBars = initialFill ? LOOKAHEAD_BEATS / barBeats : MAX_BARS_PER_TICK;
      const clock = this.renderer.getBeat();
      const playbackBar = Math.floor(clock / barBeats);
      this.engine.prefetch?.(this.nextBar, maxBars, params);
      this.engine.prefetch?.(playbackBar, LOOKAHEAD_BEATS / barBeats, params);
      for (let i = 0; i < maxBars; i++) {
        const clock = this.renderer.getBeat();
        const ahead = this.nextBar * barBeats - clock;
        if (ahead >= LOOKAHEAD_BEATS) break;
        const batch = this.engine.renderBars(this.nextBar, 1, params);
        this.collectMarkers(batch);
        this.feed.add(batch);
        this.renderer.schedule(batch);
        this.nextBar += 1;
      }
    } catch (err) {
      console.error('[Conductor] generation failed', err);
    } finally {
      this.pumping = false;
    }
  }

  private collectMarkers(batch: EventBatch): void {
    const lastTempo = [...this.markers].reverse().find((m) => m.type === 'tempo');
    if (!lastTempo || (lastTempo.type === 'tempo' && lastTempo.tempo !== batch.tempo)) {
      this.markers.push({ beat: batch.startBeat, type: 'tempo', tempo: batch.tempo });
    }
    for (const ev of batch.events) {
      if (ev.kind === 'section') this.markers.push({ beat: ev.beat, type: 'section', ev });
    }
    this.markers.sort((a, b) => a.beat - b.beat);
  }

  private updateNow(): void {
    const beat = this.renderer.getBeat();
    const patch: Partial<ReturnType<typeof useStore.getState>['now']> = {};
    while (this.markers.length && this.markers[0].beat <= beat + 0.01) {
      const m = this.markers.shift()!;
      if (m.type === 'tempo') {
        patch.tempo = Math.round(m.tempo);
      } else {
        patch.keyLabel = keyLabel(m.ev.key);
        patch.sectionName = m.ev.name;
        patch.sectionIndex = m.ev.sectionIndex;
        if (m.ev.chord) patch.chordLabel = m.ev.chord.label;
      }
    }
    const bar = Math.floor(beat / 4);
    const beatInBar = beat - bar * 4;
    const cur = useStore.getState().now;
    if (cur.bar !== bar) patch.bar = bar;
    if (Math.floor(cur.beatInBar) !== Math.floor(beatInBar)) patch.beatInBar = beatInBar;
    if (Object.keys(patch).length) useStore.getState().setNow(patch);
  }
}
