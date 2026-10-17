/**
 * Auteur engine: same musical content as LocalEngine (chords, layers, form), but timbral
 * evolution is owned by buildAuteurAutomation() — waves, envelopes, sends, filters over time.
 */
import type { EventBatch, GenerationParams, MusicEvent } from '@shared/index';
import { LocalEngine } from './localEngine';
import { buildAuteurAutomation } from './auteurTimbral';
import type { ComposerEngine, EngineInfo } from './types';

const PRIORITY = (e: MusicEvent): number =>
  e.kind === 'section' ? 0 : e.kind === 'automation' ? 1 : 2;

export class AuteurEngine implements ComposerEngine {
  readonly info: EngineInfo = {
    id: 'js-auteur',
    name: 'Auteur (timbral director)',
  };

  private readonly local = new LocalEngine();

  init(seed: number, params: GenerationParams): void {
    this.local.init(seed, params);
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    const batch = this.local.renderBars(fromBar, count, params);
    const musical = batch.events.filter((e) => e.kind !== 'automation');
    const timbral = buildAuteurAutomation(fromBar, fromBar + count, params, params.seed >>> 0);
    const events = [...musical, ...timbral].sort(
      (a, b) => a.beat - b.beat || PRIORITY(a) - PRIORITY(b),
    );
    return { ...batch, events };
  }

  get sections() {
    return this.local.sections;
  }
}
