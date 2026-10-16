import { describe, expect, it } from 'vitest';
import type { EventBatch, GenerationParams } from '@shared/index';
import { FailoverEngine } from './failoverEngine';
import { LocalEngine } from './localEngine';
import { RemoteEngine } from './remoteEngine';
import { BackendClient } from '../services/backendClient';

const params: GenerationParams = {
  mood: 'nostalgic',
  energy: 0.5,
  complexity: 0.5,
  variation: 0.5,
  tempo: 88,
  seed: 123,
};

function fakeBatch(bar: number, tempo = 88): EventBatch {
  const start = bar * 4;
  return {
    version: 1,
    startBeat: start,
    endBeat: start + 4,
    tempo,
    timeSig: [4, 4],
    events: [{ kind: 'section', beat: start, name: 'T', sectionIndex: 0, key: { tonic: 9, scale: 'aeolian' }, energy: 0.5 }],
  };
}

describe('FailoverEngine', () => {
  it('uses local when remote buffer empty', () => {
    const client = new BackendClient();
    const remote = new RemoteEngine(client);
    remote.bindConnection(true);
    const failover = new FailoverEngine(remote, () => new LocalEngine());
    failover.init(123, params);
    const batch = failover.renderBars(0, 1, params);
    expect(batch.events.some((e) => e.kind === 'note' || e.kind === 'section')).toBe(true);
  });

  it('uses remote when buffered and keeps tempo on fallback', () => {
    const client = new BackendClient();
    const remote = new RemoteEngine(client);
    remote.bindConnection(true);
    const failover = new FailoverEngine(remote, () => new LocalEngine());
    failover.init(123, params);
    (remote as unknown as { buffer: Map<number, EventBatch> }).buffer.set(0, fakeBatch(0, 100));
    const remoteBatch = failover.renderBars(0, 1, params);
    expect(remoteBatch.tempo).toBe(100);
    const localBatch = failover.renderBars(1, 1, params);
    expect(localBatch.tempo).toBe(100);
  });

  it('injects master.filter handoff when switching to local', () => {
    const client = new BackendClient();
    const remote = new RemoteEngine(client);
    remote.bindConnection(true);
    const failover = new FailoverEngine(remote, () => new LocalEngine());
    failover.init(123, params);
    const batch = failover.renderBars(0, 1, params);
    expect(batch.events.some((e) => e.kind === 'automation' && e.target === 'master.filter')).toBe(true);
  });
});
