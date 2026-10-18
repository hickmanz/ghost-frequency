import type { AutomationEvent, EventBatch, GenerationParams, MusicEvent } from '@shared/index';
import { useStore } from '../services/store';
import { LocalEngine } from './localEngine';
import type { RemoteEngine } from './remoteEngine';
import type { ComposerEngine, EngineInfo } from './types';

const HANDOFF_RAMP_BEATS = 8;

function masterFilterDip(beat: number): AutomationEvent {
  return {
    kind: 'automation',
    target: 'master.filter',
    beat,
    value: 0.55,
    rampBeats: HANDOFF_RAMP_BEATS / 2,
  };
}

function masterFilterOpen(beat: number): AutomationEvent {
  return {
    kind: 'automation',
    target: 'master.filter',
    beat: beat + HANDOFF_RAMP_BEATS / 2,
    value: 1,
    rampBeats: HANDOFF_RAMP_BEATS / 2,
  };
}

export class FailoverEngine implements ComposerEngine {
  readonly info: EngineInfo;

  private local: LocalEngine;
  private remote: RemoteEngine;
  private active: 'remote' | 'local' = 'remote';
  private lastRemoteTempo: number | null = null;
  private pendingRecoveryBar: number | null = null;

  constructor(remote: RemoteEngine, localFactory: () => LocalEngine = () => new LocalEngine()) {
    this.remote = remote;
    this.local = localFactory();
    this.info = remote.info;
  }

  init(seed: number, params: GenerationParams): void {
    this.remote.init(seed, params);
    this.local.init(seed, params);
    this.active = 'remote';
    this.pendingRecoveryBar = null;
    useStore.getState().setBackend({ activeSource: 'remote' });
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    const preferRemote =
      this.remote.hasContiguous(fromBar, count) &&
      (this.active === 'remote' ||
        (this.pendingRecoveryBar !== null && fromBar >= this.pendingRecoveryBar && fromBar % 8 === 0));

    if (preferRemote) {
      const batch = this.remote.renderBars(fromBar, count, params);
      this.lastRemoteTempo = batch.tempo;
      if (this.active === 'local') {
        this.active = 'remote';
        this.pendingRecoveryBar = null;
        useStore.getState().setBackend({ activeSource: 'remote' });
        return this.injectHandoff(batch, fromBar);
      }
      return batch;
    }

    const switchingToLocal = this.active === 'remote';
    if (switchingToLocal) {
      this.active = 'local';
      useStore.getState().setBackend({ activeSource: 'local' });
      this.pendingRecoveryBar = Math.ceil((fromBar + 1) / 8) * 8;
    }
    let batch = this.local.renderBars(fromBar, count, params);
    if (this.lastRemoteTempo !== null) batch = { ...batch, tempo: this.lastRemoteTempo };
    return switchingToLocal ? this.injectHandoff(batch, fromBar) : batch;
  }

  prefetch(fromBar: number, count: number, params: GenerationParams): void {
    if (this.remote.getEngineId() === 'py-neural-layers') return;
    this.remote.prefetch(fromBar, count, params);
  }

  dispose(): void {
    this.remote.dispose();
  }

  bindRemoteConnected(connected: boolean): void {
    this.remote.bindConnection(connected);
  }

  setRemoteEngineId(id: string): void {
    this.remote.setEngineId(id);
  }

  private injectHandoff(batch: EventBatch, fromBar: number): EventBatch {
    const beat = fromBar * 4;
    const extras: MusicEvent[] = [masterFilterDip(beat), masterFilterOpen(beat)];
    return { ...batch, events: [...extras, ...batch.events] };
  }
}
