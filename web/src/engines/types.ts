import type { EventBatch, GenerationParams } from '@shared/index';

import type { EngineMode, LayerId } from '@shared/index';

export interface EngineInfo {
  id: string;
  name: string;
  mode?: EngineMode;
  layers?: LayerId[];
}

/**
 * Composition engine contract. Implemented by LocalEngine (browser, TS) now and
 * a RemoteEngine (Python over WebSocket) later. Must not import Tone.js or DOM APIs.
 *
 * Contract:
 *  - init() resets all state; the same seed + same sequence of params gives the same output.
 *  - renderBars() is called with strictly consecutive bars (fromBar = previous fromBar + count).
 *    Long-range section planning happens lazily/internally; notes are written just-in-time
 *    using the *current* params so live control changes are heard within a bar or two.
 *  - Batch beats are absolute (bar N starts at beat N * timeSig[0]).
 */
export interface ComposerEngine {
  readonly info: EngineInfo;
  init(seed: number, params: GenerationParams): void;
  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch;
  /** Drop composition state from `bar` so bars can be re-rendered with new controls. */
  rewind?(bar: number): void;
  /** Jump timeline to the start of the next song (returns target bar). */
  skipToNextSong?(fromBar: number, params: GenerationParams): number;
  /** Optional: request upcoming bars (network engines). */
  prefetch?(fromBar: number, count: number, params: GenerationParams): void;
  dispose?(): void;
}
