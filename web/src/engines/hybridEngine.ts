import type { EventBatch, GenerationParams, MusicEvent, NoteEvent } from '@shared/index';
import { SCHEMA_VERSION } from '@shared/index';
import { useStore } from '../services/store';
import { LocalEngine } from './localEngine';
import type { RemoteEngine } from './remoteEngine';
import { NEURAL_LAYERS, buildContextRange } from './barContext';
import type { ComposerEngine, EngineInfo } from './types';

const STRUCTURE_AHEAD = 12;
const BAR_BEATS = 4;

function mergeNeuralLayers(local: EventBatch, remote: EventBatch | null): EventBatch {
  if (!remote) return local;
  const kept = local.events.filter((e) => e.kind !== 'note' || !NEURAL_LAYERS.has(e.layer));
  const neural = remote.events.filter(
    (e): e is NoteEvent => e.kind === 'note' && NEURAL_LAYERS.has(e.layer),
  );
  const events: MusicEvent[] = [...kept, ...neural].sort((a, b) => a.beat - b.beat);
  return { ...local, tempo: remote.tempo ?? local.tempo, events };
}

function combineLocalBars(batches: EventBatch[], fromBar: number, count: number): EventBatch {
  const events: MusicEvent[] = [];
  let tempo = batches[0]?.tempo ?? 90;
  for (let i = 0; i < count; i++) {
    const b = batches[i];
    if (!b) continue;
    events.push(...b.events);
    tempo = b.tempo;
  }
  return {
    version: SCHEMA_VERSION,
    startBeat: fromBar * BAR_BEATS,
    endBeat: (fromBar + count) * BAR_BEATS,
    tempo,
    timeSig: [4, 4],
    events,
  };
}

export class HybridEngine implements ComposerEngine {
  info: EngineInfo;

  private local: LocalEngine;
  private structureBuffer = new Map<number, EventBatch>();

  constructor(
    private readonly remote: RemoteEngine,
    localFactory: () => LocalEngine = () => new LocalEngine(),
  ) {
    this.local = localFactory();
    this.info = { id: 'py-neural-layers', name: 'Neural layers (hybrid)' };
  }

  init(seed: number, params: GenerationParams): void {
    this.local.init(seed, params);
    this.remote.init(seed, params);
    this.structureBuffer.clear();
  }

  private ensureStructure(fromBar: number, count: number, params: GenerationParams): void {
    const end = fromBar + count + STRUCTURE_AHEAD;
    for (let bar = fromBar; bar < end; bar++) {
      if (this.structureBuffer.has(bar)) continue;
      const batch = this.local.renderBars(bar, 1, params);
      this.structureBuffer.set(bar, batch);
    }
    for (const bar of [...this.structureBuffer.keys()]) {
      if (bar < fromBar - 4) this.structureBuffer.delete(bar);
    }
  }

  prefetch(fromBar: number, count: number, params: GenerationParams): void {
    this.ensureStructure(fromBar, count, params);
    const ahead = this.remote.prefetchAhead;
    const ctx: ReturnType<typeof buildContextRange> = [];
    for (let i = 0; i < ahead; i++) {
      const bar = fromBar + i;
      const batch = this.structureBuffer.get(bar);
      if (!batch) continue;
      ctx.push(...buildContextRange(batch, bar, 1));
    }
    if (ctx.length < ahead) return;
    this.remote.setRenderContext(ctx);
    this.remote.prefetch(fromBar, count, params);
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    this.ensureStructure(fromBar, count, params);
    const slices: EventBatch[] = [];
    for (let i = 0; i < count; i++) {
      const bar = fromBar + i;
      const b = this.structureBuffer.get(bar);
      if (b) slices.push(b);
    }
    const local = combineLocalBars(slices, fromBar, count);

    let remote: EventBatch | null = null;
    if (this.remote.hasContiguous(fromBar, count)) {
      try {
        remote = this.remote.renderBars(fromBar, count, params);
      } catch {
        remote = null;
      }
    }
    const merged = mergeNeuralLayers(local, remote);
    useStore.getState().setBackend({
      activeSource: remote ? 'remote' : 'local',
    });
    return merged;
  }

  dispose(): void {
    this.structureBuffer.clear();
    this.remote.dispose();
  }

  bindRemoteConnected(connected: boolean): void {
    this.remote.bindConnection(connected);
  }

  setRemoteEngineId(id: string): void {
    this.remote.setEngineId(id);
  }
}
