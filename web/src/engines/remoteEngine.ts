import type { EventBatch, GenerationParams } from '@shared/index';
import type { BackendClient } from '../services/backendClient';
import { useStore } from '../services/store';
import type { ComposerEngine, EngineInfo } from './types';

const PREFETCH_AHEAD = 8;
const KEEP_BARS = 2;

function batchForSingleBar(full: EventBatch, bar: number): EventBatch {
  const barBeats = 4;
  const start = bar * barBeats;
  const end = start + barBeats;
  return {
    ...full,
    startBeat: start,
    endBeat: end,
    events: full.events.filter((e) => e.beat >= start && e.beat < end),
  };
}

function barInBatch(batch: EventBatch, bar: number): boolean {
  const barBeats = 4;
  const start = bar * barBeats;
  const end = start + barBeats;
  if (!Number.isFinite(batch.startBeat) || !Number.isFinite(batch.endBeat)) return false;
  return batch.startBeat <= start + 1e-6 && batch.endBeat >= end - 1e-6;
}

export class RemoteEngine implements ComposerEngine {
  readonly info: EngineInfo = { id: 'remote', name: 'Remote (Python)' };

  private buffer = new Map<number, EventBatch>();
  private epoch = 0;
  private seed = 0;
  private engineId = 'py-markov';
  private lastParams: GenerationParams | null = null;
  private highestRequested = -1;
  private connected = false;
  private unsub: (() => void) | null = null;

  constructor(private readonly client: BackendClient) {
    this.unsub = client.subscribe((msg) => {
      if (msg.type !== 'batch') return;
      if (msg.epoch !== this.epoch) return;
      const barBeats = 4;
      const firstBar = Math.round(msg.batch.startBeat / barBeats);
      const lastBar = Math.round(msg.batch.endBeat / barBeats);
      for (let bar = firstBar; bar < lastBar; bar++) {
        if (!barInBatch(msg.batch, bar)) continue;
        this.buffer.set(bar, batchForSingleBar(msg.batch, bar));
      }
      useStore.getState().setBackend({ latencyMs: client.latencyMs });
    });
  }

  bindConnection(connected: boolean): void {
    this.connected = connected;
  }

  setEngineId(id: string): void {
    this.engineId = id;
  }

  hasBar(bar: number): boolean {
    return this.buffer.has(bar);
  }

  hasContiguous(fromBar: number, count: number): boolean {
    for (let i = 0; i < count; i++) if (!this.buffer.has(fromBar + i)) return false;
    return true;
  }

  peekTempo(bar: number): number | null {
    return this.buffer.get(bar)?.tempo ?? null;
  }

  init(seed: number, params: GenerationParams): void {
    this.seed = seed >>> 0;
    this.lastParams = { ...params, seed: this.seed };
    this.buffer.clear();
    this.highestRequested = -1;
    this.epoch += 1;
    if (this.connected) {
      this.client.send({
        type: 'init',
        epoch: this.epoch,
        seed: this.seed,
        engineId: this.engineId,
        params: this.lastParams,
      });
    }
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    const p = { ...params, seed: this.seed };
    if (!this.lastParams) this.init(p.seed, p);
    this.lastParams = p;

    for (let i = 0; i < count; i++) {
      if (!this.buffer.has(fromBar + i)) {
        throw new Error(`RemoteEngine: bar ${fromBar + i} not buffered`);
      }
    }

    const events = [];
    for (let i = 0; i < count; i++) events.push(...this.buffer.get(fromBar + i)!.events);
    const barBeats = 4;
    const startBeat = fromBar * barBeats;
    const endBeat = (fromBar + count) * barBeats;
    const tempo = this.buffer.get(fromBar)?.tempo ?? 90;
    for (let bar = fromBar; bar < fromBar + count; bar++) this.buffer.delete(bar);

    return {
      version: 1,
      startBeat,
      endBeat,
      tempo,
      timeSig: [4, 4],
      events,
    };
  }

  prefetch(fromBar: number, _count: number, params: GenerationParams): void {
    if (!this.connected || !this.lastParams) return;
    const p = { ...params, seed: this.seed };
    this.dropStaleBuffer(p, fromBar);

    let needFrom = -1;
    let needCount = 0;
    for (let i = 0; i < PREFETCH_AHEAD; i++) {
      const bar = fromBar + i;
      if (this.buffer.has(bar)) continue;
      if (needFrom < 0) needFrom = bar;
      needCount += 1;
    }
    if (needCount === 0 || needFrom < 0) return;
    if (needFrom + needCount - 1 <= this.highestRequested && this.buffer.has(needFrom)) return;

    this.highestRequested = Math.max(this.highestRequested, needFrom + needCount - 1);
    this.client.send({
      type: 'render',
      epoch: this.epoch,
      fromBar: needFrom,
      count: Math.min(needCount, 16),
      params: p,
    });
  }

  private dropStaleBuffer(params: GenerationParams, playbackBar: number): void {
    if (!this.lastParams) return;
    const changed =
      params.mood !== this.lastParams.mood ||
      params.energy !== this.lastParams.energy ||
      params.complexity !== this.lastParams.complexity ||
      params.variation !== this.lastParams.variation ||
      params.tempo !== this.lastParams.tempo;
    if (!changed) return;
    for (const bar of [...this.buffer.keys()]) {
      if (bar > playbackBar + KEEP_BARS) this.buffer.delete(bar);
    }
    this.highestRequested = playbackBar + KEEP_BARS;
    this.lastParams = { ...params, seed: this.seed };
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.buffer.clear();
  }
}
