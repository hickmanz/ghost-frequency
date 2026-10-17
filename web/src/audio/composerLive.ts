import type { LayerId } from '@shared/index';

/**
 * Read-only snapshot of composer-driven automation (Auteur, future engines).
 * Updated by the audio graph when automation events are applied; consumed by Sound Lab visuals.
 */
export class ComposerLiveState {
  private params = new Map<string, number>();
  private filters = new Map<LayerId, number>();
  private version = 0;

  setParam(key: string, nativeValue: number): void {
    if (!Number.isFinite(nativeValue)) return;
    const prev = this.params.get(key);
    if (prev !== undefined && Math.abs(prev - nativeValue) < 1e-6) return;
    this.params.set(key, nativeValue);
    this.version++;
  }

  setFilter(layer: LayerId, openness01: number): void {
    const v = Math.max(0, Math.min(1, openness01));
    const prev = this.filters.get(layer);
    if (prev !== undefined && Math.abs(prev - v) < 1e-6) return;
    this.filters.set(layer, v);
    this.version++;
  }

  getParam(key: string): number | undefined {
    return this.params.get(key);
  }

  getFilter(layer: LayerId): number | undefined {
    return this.filters.get(layer);
  }

  getVersion(): number {
    return this.version;
  }

  clear(): void {
    if (this.params.size === 0 && this.filters.size === 0) return;
    this.params.clear();
    this.filters.clear();
    this.version++;
  }

  /** For debugging / tests */
  snapshot(): { params: Record<string, number>; filters: Partial<Record<LayerId, number>> } {
    return {
      params: Object.fromEntries(this.params),
      filters: Object.fromEntries(this.filters),
    };
  }
}
