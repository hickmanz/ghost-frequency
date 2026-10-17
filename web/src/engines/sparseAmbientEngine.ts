/**
 * Alternate in-browser composer: minimal harmonic motion, long sustains, very little rhythm.
 * Same EventBatch contract as LocalEngine; different musical choices (for A/B and experiments).
 */
import type { EventBatch, GenerationParams, KeySpec, MusicEvent, SectionEvent } from '@shared/index';
import { MOOD_IDS, SCHEMA_VERSION } from '@shared/index';
import { generateProgression, progressionBars, type Progression } from '../composition/harmony';
import { BEATS_PER_BAR } from '../composition/layers/context';
import { MOODS } from '../composition/moods';
import { int, stream, weightedPick } from '../composition/rng';
import { clamp, clamp01, toChordSpec } from '../composition/theory';
import type { ComposerEngine, EngineInfo } from './types';

const SECTION_EVERY = 16;

function sanitizeParams(p: GenerationParams): GenerationParams {
  return {
    mood: MOOD_IDS.includes(p.mood) ? p.mood : 'nostalgic',
    energy: clamp01(p.energy),
    complexity: clamp01(p.complexity),
    variation: clamp01(p.variation),
    tempo: p.tempo !== null && Number.isFinite(p.tempo) ? clamp(p.tempo, 40, 200) : null,
    seed: p.seed >>> 0,
  };
}

export class SparseAmbientEngine implements ComposerEngine {
  readonly info: EngineInfo = { id: 'js-sparse', name: 'Sparse ambient (JavaScript)' };

  private seed = 0;
  private key: KeySpec | null = null;
  private prog: Progression | null = null;
  private baseTempo = 78;

  init(seed: number, params: GenerationParams): void {
    const p = sanitizeParams({ ...params, seed });
    this.seed = p.seed;
    const mood = MOODS[p.mood];
    const [lo, hi] = mood.tempo;
    const cap = Math.max(lo, hi - 12);
    this.baseTempo = int(stream(this.seed, 'tempo'), lo, cap);
    const keyRng = stream(this.seed, 'sparse', 'key');
    const tonic = weightedPick(
      keyRng,
      mood.tonicWeights.map((w, i) => [i, w] as const),
    );
    const scale = weightedPick(keyRng, mood.scales);
    this.key = { tonic, scale };
    this.prog = generateProgression(this.key, mood, stream(this.seed, 'sparse', 'prog'));
  }

  private tempo(params: GenerationParams): number {
    const p = sanitizeParams(params);
    return p.tempo !== null && Number.isFinite(p.tempo) ? clamp(p.tempo, 40, 200) : this.baseTempo;
  }

  private chordAt(bar: number, params: GenerationParams) {
    if (!this.prog) this.init(params.seed, params);
    const total = progressionBars(this.prog!.chords);
    let b = bar % total;
    for (const ch of this.prog!.chords) {
      if (b < ch.bars) return ch;
      b -= ch.bars;
    }
    return this.prog!.chords[0]!;
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    const p = sanitizeParams(params);
    if (!this.key || this.seed !== p.seed) this.init(p.seed, p);

    const events: MusicEvent[] = [];
    const endBar = fromBar + Math.max(0, count);

    for (let bar = fromBar; bar < endBar; bar++) {
      const beat0 = bar * BEATS_PER_BAR;
      const chord = this.chordAt(bar, p);
      const energy = clamp01(p.energy * 0.85);
      const secIdx = Math.floor(bar / SECTION_EVERY);

      if (bar % 4 === 0) {
        const ev: SectionEvent = {
          kind: 'section',
          beat: beat0,
          name: secIdx === 0 ? 'Drift' : 'Haze',
          sectionIndex: secIdx,
          key: { ...this.key! },
          chord: toChordSpec(chord),
          energy,
        };
        events.push(ev);
      }

      const root = 36 + chord.rootPc;
      const padVoicing = [root, root + chord.intervals[1]!, root + chord.intervals[2]!];
      if (p.complexity > 0.4) padVoicing.push(root + 12);

      for (const midi of padVoicing) {
        events.push({
          kind: 'note',
          layer: 'pad',
          beat: beat0,
          durBeats: BEATS_PER_BAR * (2 + p.variation),
          midi,
          vel: clamp(0.28 + energy * 0.2, 0.15, 0.55),
        });
      }

      events.push({
        kind: 'note',
        layer: 'bass',
        beat: beat0,
        durBeats: BEATS_PER_BAR * 1.5,
        midi: root - 12,
        vel: clamp(0.35 + energy * 0.15, 0.2, 0.5),
      });

      if (bar % 2 === 0 && p.variation > 0.25) {
        events.push({
          kind: 'note',
          layer: 'arp',
          beat: beat0 + 1,
          durBeats: 2,
          midi: root + 12,
          vel: 0.22,
        });
      }

      if (bar % 8 === 0) {
        events.push({
          kind: 'automation',
          target: 'send.reverb',
          beat: beat0,
          value: clamp01(0.45 + p.variation * 0.25),
          rampBeats: 8,
        });
      }
    }

    const startBeat = fromBar * BEATS_PER_BAR;
    const endBeat = endBar * BEATS_PER_BAR;
    events.sort((a, b) => a.beat - b.beat);

    return {
      version: SCHEMA_VERSION,
      startBeat,
      endBeat,
      tempo: this.tempo(p),
      timeSig: [4, 4],
      events: events.filter((e) => e.beat >= startBeat && e.beat < endBeat),
    };
  }
}
