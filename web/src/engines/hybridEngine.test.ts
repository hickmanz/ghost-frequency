import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@shared/index';
import { buildBarContext } from './barContext';
import { HybridEngine } from './hybridEngine';
import { LocalEngine } from './localEngine';
import { RemoteEngine } from './remoteEngine';
import type { BackendClient } from '../services/backendClient';

class FakeClient {
  listeners = new Set<(msg: unknown) => void>();
  subscribe(fn: (msg: unknown) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  send(_msg: unknown): void {}
  get latencyMs() {
    return 1;
  }
}

describe('HybridEngine', () => {
  it('keeps pad/structure from local when remote has no buffer', () => {
    const remote = new RemoteEngine(new FakeClient() as unknown as BackendClient);
    const hybrid = new HybridEngine(remote, () => new LocalEngine());
    const params = { ...DEFAULT_PARAMS, seed: 1001 };
    hybrid.init(params.seed, params);
    const batch = hybrid.renderBars(0, 2, params);
    expect(batch.events.some((e) => e.kind === 'section')).toBe(true);
    expect(batch.events.some((e) => e.kind === 'note' && e.layer === 'pad')).toBe(true);
  });

  it('buildBarContext extracts chord from local batch', () => {
    const local = new LocalEngine();
    const params = { ...DEFAULT_PARAMS, seed: 42 };
    local.init(params.seed, params);
    const batch = local.renderBars(0, 1, params);
    const ctx = buildBarContext(batch, 0);
    expect(ctx?.chord.label).toBeTruthy();
    expect(ctx?.padVoicing.length).toBeGreaterThan(0);
  });
});
