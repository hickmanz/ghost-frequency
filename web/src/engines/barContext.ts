import type { BarContext, EventBatch, LayerId, MusicEvent, NoteEvent, SectionEvent } from '@shared/index';
import { LAYER_IDS } from '@shared/index';

const BAR_BEATS = 4;
const NEURAL_LAYERS = new Set<LayerId>(['lead', 'arp', 'bass', 'drums']);

export { NEURAL_LAYERS };

export function eventsForBar(batch: EventBatch, bar: number): MusicEvent[] {
  const start = bar * BAR_BEATS;
  const end = start + BAR_BEATS;
  return batch.events.filter((e) => e.beat >= start && e.beat < end);
}

export function buildBarContext(batch: EventBatch, bar: number): BarContext | null {
  const inBar = eventsForBar(batch, bar);
  const sections = inBar.filter((e): e is SectionEvent => e.kind === 'section');
  const section = sections.sort((a, b) => b.beat - a.beat)[0];
  if (!section?.chord) return null;

  const notes = inBar.filter((e): e is NoteEvent => e.kind === 'note');
  const activeLayers: LayerId[] = [];
  for (const layer of LAYER_IDS) {
    if (notes.some((n) => n.layer === layer)) activeLayers.push(layer);
  }
  if (!activeLayers.includes('pad') && notes.some((n) => n.layer === 'pad')) activeLayers.push('pad');

  const padVoicing = notes
    .filter((n) => n.layer === 'pad' && Math.abs(n.beat - bar * BAR_BEATS) < 0.01)
    .map((n) => n.midi)
    .sort((a, b) => a - b);

  return {
    bar,
    sectionName: section.name,
    sectionIndex: section.sectionIndex,
    key: { ...section.key },
    chord: { ...section.chord },
    energy: section.energy,
    activeLayers: activeLayers.length > 0 ? activeLayers : ['pad', 'bass', 'arp', 'lead'],
    padVoicing,
  };
}

export function buildContextRange(batch: EventBatch, fromBar: number, count: number): BarContext[] {
  const out: BarContext[] = [];
  for (let i = 0; i < count; i++) {
    const bar = fromBar + i;
    const ctx = buildBarContext(batch, bar);
    if (ctx) out.push(ctx);
  }
  return out;
}
