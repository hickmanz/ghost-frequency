/**
 * Developed engine: the same Form, grammars, and motif bank as Full, plus pass arrangement
 * (last-pass harmonic color, density, shared motif, swing, kick duck, sparse bell).
 * Full's render path never calls this class, so the same seed on Full stays the same piece.
 */
import type {
  EventBatch,
  GenerationParams,
  MoodId,
  MusicEvent,
  NoteEvent,
  SectionEvent,
} from '@shared/index';
import { MOOD_IDS, SCHEMA_VERSION } from '@shared/index';
import { renderAutomation } from '../composition/automation';
import { Form, LOCK_BARS, PLAN_KEEP_BARS } from '../composition/form';
import { BEATS_PER_BAR, energyAt, type LayerContext } from '../composition/layers/context';
import { renderArp } from '../composition/layers/arp';
import { renderBass } from '../composition/layers/bass';
import { renderDrums } from '../composition/layers/drums';
import { renderLead } from '../composition/layers/lead';
import { renderPad } from '../composition/layers/pad';
import { renderTextureAutomation, renderTextureNotes } from '../composition/layers/texture';
import { MOODS } from '../composition/moods';
import { chordSegments, planEnd, type SectionPlan } from '../composition/plan';
import { int, stream } from '../composition/rng';
import { clamp, clamp01, toChordSpec } from '../composition/theory';
import { arrangeDevelopEvents } from './developArrange';
import { arrangeSection, sectionSignature, type ArrangedSection } from './developColor';
import type { ComposerEngine, EngineInfo } from './types';

const MAX_CACHE_ENTRIES = 600;

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

export class DevelopEngine implements ComposerEngine {
  readonly info: EngineInfo = { id: 'js-develop', name: 'Developed' };

  private seed = 0;
  private form: Form | null = null;
  private baseTempo = 96;
  private lastMood: MoodId = 'nostalgic';
  private cache = new Map<string, unknown>();
  private lastNote = new Map<string, NoteEvent>();
  private arranged = new Map<number, { sig: string; value: ArrangedSection }>();
  private bellUp = false;

  init(seed: number, params: GenerationParams): void {
    const p = sanitizeParams({ ...params, seed });
    this.seed = p.seed;
    this.cache = new Map();
    this.lastNote = new Map();
    this.arranged = new Map();
    this.bellUp = false;
    this.lastMood = p.mood;
    const [lo, hi] = MOODS[p.mood].tempo;
    this.baseTempo = int(stream(this.seed, 'tempo'), lo, hi);
    this.form = new Form(this.seed, p);
  }

  currentTempo(params: GenerationParams): number {
    return params.tempo !== null && Number.isFinite(params.tempo) ? clamp(params.tempo, 40, 200) : this.baseTempo;
  }

  get sections(): readonly SectionPlan[] {
    return this.form?.plans ?? [];
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    const p = sanitizeParams(params);
    if (!this.form) this.init(p.seed, p);
    const form = this.form!;
    const n = Math.max(0, Math.floor(count));
    const endBar = fromBar + n;
    const events: MusicEvent[] = [];

    if (p.mood !== this.lastMood) {
      const cur = form.sectionForBar(fromBar, p);
      form.onMoodChange(cur, endBar, p);
      this.lastMood = p.mood;
    }

    let bar = fromBar;
    while (bar < endBar) {
      const plan = form.sectionForBar(bar, p);
      const lock = planEnd(plan) - LOCK_BARS;
      let segEnd = Math.min(endBar, planEnd(plan));
      if (bar < lock && segEnd > lock) segEnd = lock;
      if (bar >= lock) form.ensureNext(plan, p);
      this.renderSegment(form, plan, bar, segEnd, p, events);
      bar = segEnd;
    }

    const startBeat = fromBar * BEATS_PER_BAR;
    const endBeat = endBar * BEATS_PER_BAR;
    const ordered = this.finalize(events, startBeat, endBeat);

    if (this.cache.size > MAX_CACHE_ENTRIES) {
      let drop = this.cache.size - MAX_CACHE_ENTRIES / 2;
      for (const k of this.cache.keys()) {
        if (drop-- <= 0) break;
        this.cache.delete(k);
      }
    }

    if (endBar > PLAN_KEEP_BARS) form.pruneBehind(endBar);

    return {
      version: SCHEMA_VERSION,
      startBeat,
      endBeat,
      tempo: this.currentTempo(p),
      timeSig: [4, 4],
      events: ordered,
    };
  }

  dispose(): void {
    this.form = null;
    this.cache.clear();
    this.lastNote.clear();
    this.arranged.clear();
  }

  private arrangedFor(plan: SectionPlan): ArrangedSection {
    const sig = sectionSignature(plan);
    const hit = this.arranged.get(plan.index);
    if (hit && hit.sig === sig) return hit.value;
    const value = arrangeSection(plan, this.seed);
    this.arranged.set(plan.index, { sig, value });
    return value;
  }

  private renderSegment(
    form: Form,
    base: SectionPlan,
    fromBar: number,
    toBar: number,
    params: GenerationParams,
    out: MusicEvent[],
  ): void {
    if (toBar <= fromBar) return;
    const arranged = this.arrangedFor(base);
    const plan = arranged.plan;
    const ctx: LayerContext = {
      seed: this.seed,
      plan,
      prev: form.prev(base),
      next: form.next(base),
      fromBar,
      toBar,
      params,
      bank: form.bank,
      cache: this.cache,
      develop: { sourceLoop: arranged.sourceLoop, passCount: arranged.passCount },
    };

    const events: MusicEvent[] = [];
    for (const seg of chordSegments(plan)) {
      const abs = plan.startBar + seg.startBar;
      if (abs < fromBar || abs >= toBar) continue;
      const ev: SectionEvent = {
        kind: 'section',
        beat: abs * BEATS_PER_BAR,
        name: plan.name,
        sectionIndex: plan.index,
        key: { ...plan.key },
        chord: toChordSpec(seg.chord),
        energy: energyAt(ctx, abs),
      };
      events.push(ev);
    }

    events.push(...renderAutomation(ctx), ...renderTextureAutomation(ctx));
    events.push(
      ...renderPad(ctx),
      ...renderTextureNotes(ctx),
      ...renderBass(ctx),
      ...renderArp(ctx),
      ...renderLead(ctx),
      ...renderDrums(ctx),
    );

    const shaped = arrangeDevelopEvents({
      events,
      plan,
      sourceLoop: arranged.sourceLoop,
      passCount: arranged.passCount,
      params,
      bank: form.bank,
      fromBar,
      toBar,
    });

    if (!this.bellUp) {
      const firstBell = shaped.find((e) => e.kind === 'note' && e.layer === 'bell');
      if (firstBell && firstBell.kind === 'note') {
        this.bellUp = true;
        shaped.push({
          kind: 'automation',
          target: 'layer.gain.bell',
          beat: firstBell.beat + 0.01,
          value: 1,
          rampBeats: 8,
        });
      }
    }

    out.push(...shaped);
  }

  private finalize(events: MusicEvent[], startBeat: number, endBeat: number): MusicEvent[] {
    const priority = (e: MusicEvent): number => (e.kind === 'section' ? 0 : e.kind === 'automation' ? 1 : 2);
    const eps = 1e-9;
    const inRange = events.filter((e) => e.beat >= startBeat - eps && e.beat < endBeat - eps);
    const indexed = inRange.map((e, i) => ({ e, i }));
    indexed.sort((a, b) => a.e.beat - b.e.beat || priority(a.e) - priority(b.e) || a.i - b.i);

    const result: MusicEvent[] = [];
    const inBatch = new Set<NoteEvent>();
    for (const { e } of indexed) {
      if (e.kind !== 'note') {
        result.push(e);
        continue;
      }
      if (e.layer !== 'drums') {
        const key = `${e.layer}:${e.midi}`;
        const prev = this.lastNote.get(key);
        if (prev && prev.beat + prev.durBeats > e.beat + 1e-6) {
          if (inBatch.has(prev) && e.beat - prev.beat >= 0.05) {
            prev.durBeats = e.beat - prev.beat;
          } else {
            continue;
          }
        }
        this.lastNote.set(key, e);
      }
      inBatch.add(e);
      result.push(e);
    }
    return result;
  }
}
