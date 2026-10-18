import * as Tone from 'tone';
import type { AutomationEvent, EventBatch, NoteEvent, PaletteEvent } from '@shared/index';
import { beatsToSeconds, clampBpm, rampBeatsToSeconds, secondsPerBeat, splitBeatToTick } from './mapping';

export type TransportLike = ReturnType<typeof Tone.getTransport>;

export interface SchedulerHost {
  onNote(ev: NoteEvent, time: number, durSeconds: number): void;
  onAutomation(ev: AutomationEvent, time: number, rampSeconds: number): void;
  /** called when the tempo target changes (immediately for the first tempo, otherwise at the batch start) */
  onTempo(bpm: number, time: number, rampSeconds: number): void;
  onPalette?(ev: PaletteEvent, time: number): void;
}

/** Length of the smooth tempo ramp in beats (measured at the new tempo). */
export const TEMPO_RAMP_BEATS = 2;
/** Pre-roll between play() and the first tick, seconds (gives the audio thread time to prepare voices). */
const START_PREROLL = 0.05;

/**
 * Beat <-> audio-clock mapping built on Tone's Transport (1 beat = 1 quarter note = PPQ ticks).
 *
 *  - Every event is scheduled with `transport.scheduleOnce` at its (floor) tick; the callback receives the exact
 *    audio-context time of that tick and we add the sub-tick fraction => sample-accurate, no setTimeout involved.
 *    `scheduleOnce` removes the event from the Transport timeline after it fires, so the timeline never grows.
 *  - Handles of events that were scheduled but can never fire (their tick had already been processed) are
 *    purged opportunistically on every schedule() call.
 *  - Pause/resume keep scheduled events valid (the Transport tick clock simply stops/continues).
 *  - Tempo: the batch tempo ramps (bpm.rampTo over TEMPO_RAMP_BEATS) starting at batch.startBeat.
 */
export class Scheduler {
  private readonly pending = new Map<number, number>(); // transport event id -> exact tick
  private maxBeat = 0;
  private targetBpm: number | null = null;
  private playRequested = false;
  private disposed = false;
  /** exceptions thrown by host callbacks (swallowed so the Transport keeps running) */
  errorCount = 0;

  constructor(
    private readonly transport: TransportLike,
    private readonly host: SchedulerHost,
    private readonly ctx: Tone.BaseContext = Tone.getContext(),
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  get ppq(): number {
    return this.transport.PPQ;
  }

  // -------------------------------------------------------------------------------------------
  // transport control
  // -------------------------------------------------------------------------------------------

  play(prerollSeconds = START_PREROLL): void {
    if (this.disposed || this.playRequested) return;
    this.playRequested = true;
    this.transport.start(this.ctx.now() + prerollSeconds);
  }

  pause(): void {
    if (this.disposed || !this.playRequested) return;
    this.playRequested = false;
    this.transport.pause(this.ctx.now());
  }

  isPlaying(): boolean {
    return this.playRequested;
  }

  /** Cancel pending events at or after `beat`. Returns count cancelled. */
  cancelFrom(beat: number): number {
    const { tick } = splitBeatToTick(beat, this.ppq);
    let n = 0;
    for (const [id, t] of this.pending) {
      if (t >= tick) {
        this.transport.clear(id);
        this.pending.delete(id);
        n++;
      }
    }
    return n;
  }

  /** Jump the transport clock and drop all pending scheduled events (skip song / hard seek). */
  seekToBeat(beat: number): void {
    if (this.disposed) return;
    const b = Math.max(0, beat);
    for (const id of [...this.pending.keys()]) {
      this.transport.clear(id);
      this.pending.delete(id);
    }
    const { tick } = splitBeatToTick(b, this.ppq);
    this.transport.ticks = tick;
    this.maxBeat = b;
    this.targetBpm = null;
  }

  /** Cancel every scheduled event, stop the transport and rewind to beat 0. */
  stopAndRewind(): void {
    for (const id of this.pending.keys()) this.transport.clear(id);
    this.pending.clear();
    const now = this.ctx.now();
    this.transport.stop(now);
    this.transport.cancel(0);
    this.transport.ticks = 0;
    this.transport.bpm.cancelScheduledValues(now);
    this.playRequested = false;
    this.maxBeat = 0;
    this.targetBpm = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopAndRewind();
    this.disposed = true;
  }

  // -------------------------------------------------------------------------------------------
  // beat clock
  // -------------------------------------------------------------------------------------------

  /** Scheduling frontier in ticks: events at/below this tick can no longer fire. */
  private frontierTicks(): number {
    return this.transport.ticks;
  }

  /** Beat position of the scheduling frontier (slightly ahead of what is audible by the context lookahead). */
  getFrontierBeat(): number {
    return this.frontierTicks() / this.ppq;
  }

  /** Smooth audible beat: transport ticks evaluated at the raw audio clock minus output latency. */
  getBeat(): number {
    if (this.transport.state !== 'started') return this.transport.ticks / this.ppq;
    const raw = (this.ctx.rawContext as { outputLatency?: number }).outputLatency;
    const latency = typeof raw === 'number' && raw >= 0 && raw < 0.5 ? raw : 0;
    const t = Math.max(0, this.ctx.currentTime - latency);
    return Math.max(0, this.transport.getTicksAtTime(t)) / this.ppq;
  }

  /** (furthest scheduled batch end / event beat) - current beat, >= 0. */
  getScheduledAheadBeats(): number {
    return Math.max(0, this.maxBeat - this.getBeat());
  }

  // -------------------------------------------------------------------------------------------
  // scheduling
  // -------------------------------------------------------------------------------------------

  schedule(batch: EventBatch): void {
    if (this.disposed) return;
    this.purgeStale();
    this.scheduleTempo(batch);
    if (Number.isFinite(batch.endBeat)) this.maxBeat = Math.max(this.maxBeat, batch.endBeat);

    for (const ev of batch.events) {
      if (ev.kind === 'note') this.scheduleNote(ev);
      else if (ev.kind === 'automation') this.scheduleAutomation(ev);
      else if (ev.kind === 'palette') this.schedulePalette(ev);
      // 'section' and 'audioClip' events are ignored by the audio renderer in v1
    }
  }

  private isPast(tick: number): boolean {
    const f = Math.floor(this.frontierTicks());
    // while stopped/paused nothing has been processed beyond the frozen position
    return this.transport.state === 'started' ? tick <= f : tick < f;
  }

  private scheduleNote(ev: NoteEvent): void {
    if (!(ev.vel > 0) || !Number.isFinite(ev.beat) || ev.midi < 0 || ev.midi > 127) return;
    if (!(ev.durBeats > 0)) return;
    this.scheduleAt(ev.beat, (time) => {
      const dur = beatsToSeconds(ev.durBeats, this.transport.bpm.value);
      this.host.onNote(ev, time, dur);
    });
    this.maxBeat = Math.max(this.maxBeat, ev.beat);
  }

  private schedulePalette(ev: PaletteEvent): void {
    if (!this.host.onPalette || !Number.isFinite(ev.beat)) return;
    this.scheduleAt(ev.beat, (time) => this.host.onPalette!(ev, time));
  }

  private scheduleAutomation(ev: AutomationEvent): void {
    if (!Number.isFinite(ev.beat) || !Number.isFinite(ev.value)) return;
    this.scheduleAt(ev.beat, (time) => {
      this.host.onAutomation(ev, time, rampBeatsToSeconds(ev.rampBeats, this.transport.bpm.value));
    });
    this.maxBeat = Math.max(this.maxBeat, ev.beat + (ev.rampBeats ?? 0));
  }

  private scheduleTempo(batch: EventBatch): void {
    if (!Number.isFinite(batch.tempo)) return;
    const bpm = clampBpm(batch.tempo);
    if (this.targetBpm !== null && Math.abs(bpm - this.targetBpm) < 0.01) return;
    const first = this.targetBpm === null;
    this.targetBpm = bpm;
    if (first) {
      // nothing audible depends on the old tempo yet: set directly
      this.transport.bpm.value = bpm;
      this.host.onTempo(bpm, this.ctx.now(), 0);
      return;
    }
    const ramp = TEMPO_RAMP_BEATS * secondsPerBeat(bpm);
    const apply = (time: number): void => {
      this.transport.bpm.rampTo(bpm, ramp, time);
      this.host.onTempo(bpm, time, ramp);
    };
    const beat = Math.max(batch.startBeat, 0);
    const { tick } = splitBeatToTick(beat, this.ppq);
    if (this.isPast(tick)) apply(this.ctx.now());
    else this.scheduleAt(beat, apply);
  }

  /** schedule fn(time) at an absolute beat; silently drops events already in the past. */
  private scheduleAt(beat: number, fn: (time: number) => void): void {
    const ppq = this.ppq;
    const { tick, fraction } = splitBeatToTick(beat, ppq);
    if (this.isPast(tick)) return;
    let id = -1;
    id = this.transport.scheduleOnce((time) => {
      this.pending.delete(id);
      try {
        const spt = 60 / (this.transport.bpm.value * ppq); // seconds per tick (approx. during ramps)
        fn(time + fraction * spt);
      } catch (err) {
        this.errorCount++;
        if (this.errorCount <= 5) console.warn('[audio] event callback failed', err);
      }
    }, `${tick}i`) as unknown as number;
    this.pending.set(id, tick);
  }

  /** Remove handles of events that can no longer fire (their tick is more than a beat behind the frontier). */
  private purgeStale(): void {
    const limit = this.frontierTicks() - this.ppq;
    for (const [id, tick] of this.pending) {
      if (tick < limit) {
        this.transport.clear(id);
        this.pending.delete(id);
      }
    }
  }
}
