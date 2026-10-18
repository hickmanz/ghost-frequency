import { MOOD_IDS, type EventBatch, type LayerId, type MoodId, type SectionEvent } from '@shared/index';
import type { TuningOverrides } from '../tuning/schema';
import type { AudioRenderer } from '../audio/types';
import type { ComposerEngine } from './types';
import type { PlaybackController } from '../services/controller';
import { useStore } from '../services/store';
import { effectiveParams, effectiveTone, pinSet } from '../services/director/effective';
import { rerollSongHomes } from '../services/director/songMacros';
import { keyLabel } from '../composition/theory';
import { EventFeed } from './eventFeed';

/** How far ahead (in beats) of the audio clock we keep notes scheduled. 2 bars of 4/4 for local engines. */
const LOOKAHEAD_BEATS = 8;
const MAX_BARS_PER_TICK = 4;
const PUMP_MS = 150;
const FLUSH_MARGIN_BEATS = 0.4;
const FLUSH_DEBOUNCE_MS = 70;
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
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rolling window of generated events for main-screen visuals (history + lookahead). */
  readonly feed = new EventFeed();

  private static grooveChanged(a: ReturnType<typeof useStore.getState>, b: ReturnType<typeof useStore.getState>): boolean {
    return (
      a.params !== b.params ||
      a.steer !== b.steer ||
      a.tone !== b.tone ||
      a.chaos.amount !== b.chaos.amount ||
      a.chaos.rate !== b.chaos.rate
    );
  }

  private liveParams() {
    const st = useStore.getState();
    return effectiveParams(st.params, st.mod, pinSet(st.pins));
  }

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
        if (Conductor.grooveChanged(state, prev)) this.scheduleFlush();
        if (state.tone !== prev.tone || state.mod !== prev.mod) this.applyToneMacros();
      }),
    );
  }

  async play(): Promise<void> {
    const st = useStore.getState();
    if (!this.started) {
      // mixer / mute / solo go in BEFORE start() so the graph is built with them, instead of being built with
      // defaults and immediately re-ramped at the same audio time
      this.renderer.setMixer(st.mixer);
      this.renderer.setSolo(st.solo);
      for (const layer of Object.keys(st.muted) as LayerId[]) this.renderer.setLayerMuted(layer, !!st.muted[layer]);
      await this.renderer.start();
      this.started = true;
      this.applyTuning(st.tuning, {});
      this.renderer.setMixer(useStore.getState().mixer);
      this.renderer.setMood(st.params.mood);
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

  skipSong(): void {
    if (!this.started || this.resetting) return;
    const params = this.liveParams();
    const playBeat = this.renderer.getBeat();
    const playBar = Math.floor(playBeat / 4);
    let jumpBar = this.engine.skipToNextSong?.(playBar, params) ?? playBar + 24;
    if (!Number.isFinite(jumpBar) || jumpBar <= playBar) jumpBar = playBar + 24;

    const jumpBeat = jumpBar * 4;
    this.renderer.cancelFrom(playBeat);
    this.renderer.seekToBeat(jumpBeat);
    this.engine.rewind?.(jumpBar);
    this.markers = this.markers.filter((m) => m.beat < jumpBeat);
    this.feed.dropBefore(jumpBeat);
    this.nextBar = jumpBar;
    this.pump(true, jumpBeat, true);
    this.updateNow();
  }

  async exportWav(bars: number): Promise<void> {
    const { params, mixer } = useStore.getState();
    const { exportWav } = await import('./exportWav');
    await exportWav(this.engineFactory(), params, mixer, bars);
  }

  dispose(): void {
    this.stopPump();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.engine.dispose?.();
    this.renderer.dispose();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private flush(): void {
    if (!this.started || this.resetting || this.pumping) return;
    const cut = this.renderer.getBeat() + FLUSH_MARGIN_BEATS;
    const cutBar = Math.floor(cut / 4);
    if (cutBar >= this.nextBar) return;
    this.renderer.cancelFrom(cut);
    this.engine.rewind?.(cutBar);
    this.markers = this.markers.filter((m) => m.beat < cut);
    this.nextBar = cutBar;
    this.pump(true, cut);
  }

  private applyToneMacros(): void {
    const st = useStore.getState();
    const tone = effectiveTone(st.tone, st.mod, pinSet(st.pins));
    this.renderer.applyToneMacros?.(tone);
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

  private pump(initialFill: boolean, fromBeat = -Infinity, force = false): void {
    if (this.pumping && !force) return;
    this.pumping = true;
    try {
      const params = this.liveParams();
      const maxBars = initialFill ? LOOKAHEAD_BEATS / 4 + 1 : MAX_BARS_PER_TICK;
      for (let i = 0; i < maxBars; i++) {
        const ahead = this.nextBar * 4 - this.renderer.getBeat();
        if (ahead >= LOOKAHEAD_BEATS) break;
        let batch = this.engine.renderBars(this.nextBar, 1, params);
        if (fromBeat > batch.startBeat) {
          batch = { ...batch, events: batch.events.filter((e) => e.beat >= fromBeat) };
        }
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
    const store = useStore.getState();
    const patch: Partial<ReturnType<typeof useStore.getState>['now']> = {};
    while (this.markers.length && this.markers[0]!.beat <= beat + 0.01) {
      const m = this.markers.shift()!;
      if (m.type === 'tempo') {
        patch.tempo = Math.round(m.tempo);
      } else {
        patch.keyLabel = keyLabel(m.ev.key);
        patch.sectionName = m.ev.name;
        patch.sectionIndex = m.ev.sectionIndex;
        if (m.ev.chord) patch.chordLabel = m.ev.chord.label;
        if (m.ev.songIndex !== undefined) patch.songIndex = m.ev.songIndex;
        if (m.ev.songTitle) patch.songTitle = m.ev.songTitle;
        if (m.ev.songProgress !== undefined) patch.songProgress = m.ev.songProgress;
        if (m.ev.songIndex !== undefined && m.ev.songIndex !== store.now.songIndex) {
          const songIdx = m.ev.songIndex;
          const title = m.ev.songTitle ?? `Song ${songIdx}`;
          const keyLabel = patch.keyLabel ?? store.now.keyLabel;
          queueMicrotask(() => {
            rerollSongHomes(songIdx);
            useStore.getState().pushHistory({ index: songIdx, title, keyLabel });
          });
        }
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
