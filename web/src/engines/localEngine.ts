/**

 * LocalEngine: the built-in procedural composer (pure TypeScript, deterministic per seed + call/param sequence).

 */

import type {

  EventBatch,

  GenerationParams,

  MoodId,

  MusicEvent,

  NoteEvent,

  PaletteEvent,

  SectionEvent,

} from '@shared/index';

import { DEFAULT_STEER, DEFAULT_VIBE, MOOD_IDS, SCHEMA_VERSION } from '@shared/index';

import { sanitizeSteer, sanitizeVibe } from '../services/presets';

import { renderAutomation } from '../composition/automation';

import { BEATS_PER_BAR, energyAt, type LayerContext } from '../composition/layers/context';

import { renderArp } from '../composition/layers/arp';

import { renderBass } from '../composition/layers/bass';

import { renderDrums } from '../composition/layers/drums';

import { renderLead } from '../composition/layers/lead';

import { renderPad } from '../composition/layers/pad';

import { renderTextureAutomation, renderTextureNotes } from '../composition/layers/texture';

import { chordSegments, planEnd, type SectionPlan } from '../composition/plan';

import { LOCK_BARS, PLAN_KEEP_BARS, SongStream, songEnd, songTempo } from '../composition/songPlan';

import type { Form } from '../composition/form';

import { clamp, clamp01, toChordSpec } from '../composition/theory';
import { swingPitchedLayers } from '../composition/swing';
// clamp01 used above in sanitizeParams

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

    vibe: p.vibe ? sanitizeVibe(p.vibe) : { ...DEFAULT_VIBE },

    contrast: clamp01(p.contrast ?? 0.5),

    steer: sanitizeSteer(p.steer, DEFAULT_STEER),

  };

}



export class LocalEngine implements ComposerEngine {

  readonly info: EngineInfo = { id: 'local-js', name: 'Built-in (JavaScript)' };



  private seed = 0;

  private stream: SongStream | null = null;

  private lastMood: MoodId = 'nostalgic';

  private cache = new Map<string, unknown>();

  private lastNote = new Map<string, NoteEvent>();

  private paletteEmitted = new Set<number>();



  init(seed: number, params: GenerationParams): void {

    const p = sanitizeParams({ ...params, seed });

    this.seed = p.seed;

    this.cache = new Map();

    this.lastNote = new Map();

    this.paletteEmitted = new Set();

    this.lastMood = p.mood;

    this.stream = new SongStream(this.seed);

  }



  currentTempo(params: GenerationParams, bar = 0): number {

    const p = sanitizeParams(params);

    if (p.tempo !== null && Number.isFinite(p.tempo)) return clamp(p.tempo, 40, 200);

    const song = this.stream?.songForBar(bar, p);

    return song ? songTempo(song, p.energy) : 96;

  }



  get sections(): readonly SectionPlan[] {

    return this.stream?.allSections() ?? [];

  }



  get songs() {

    return this.stream?.songs ?? [];

  }



  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {

    const p = sanitizeParams(params);

    if (!this.stream) this.init(p.seed, p);

    const stream = this.stream!;

    const n = Math.max(0, Math.floor(count));

    const endBar = fromBar + n;

    const events: MusicEvent[] = [];



    if (p.mood !== this.lastMood) {

      stream.wrapUpSong(fromBar);

      const { plan } = stream.sectionForBar(fromBar, p);

      stream.onMoodChange(plan, endBar, p);

      this.lastMood = p.mood;

    }



    let bar = fromBar;

    let batchTempo = this.currentTempo(p, fromBar);

    while (bar < endBar) {

      const song = stream.songForBar(bar, p);

      batchTempo = p.tempo ?? songTempo(song, p.energy);

      if (bar === song.startBar && !this.paletteEmitted.has(song.index)) {

        this.paletteEmitted.add(song.index);

        const { paletteId, overrides } = song.palette;

        const pe: PaletteEvent = {

          kind: 'palette',

          beat: bar * BEATS_PER_BAR,

          songIndex: song.index,

          paletteId,

          overrides,

        };

        events.push(pe);

      }

      const { form, plan } = stream.sectionForBar(bar, p);

      const lock = planEnd(plan) - LOCK_BARS;

      let segEnd = Math.min(endBar, planEnd(plan), songEnd(song));

      if (bar < lock && segEnd > lock) segEnd = lock;

      if (bar >= lock && planEnd(plan) < songEnd(song)) stream.ensureNext(plan, p);

      this.renderSegment(stream, form, plan, song.index, song.title, song.startBar, song.lengthBars, bar, segEnd, p, events);

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



    if (endBar > PLAN_KEEP_BARS) stream.pruneBehind(endBar);



    return {

      version: SCHEMA_VERSION,

      startBeat,

      endBeat,

      tempo: batchTempo,

      timeSig: [4, 4],

      events: ordered,

    };

  }



  rewind(bar: number): void {
    const beat = bar * BEATS_PER_BAR;
    for (const [k, n] of this.lastNote) {
      if (n.beat + n.durBeats > beat - 1e-6) this.lastNote.delete(k);
    }
    this.cache.clear();
  }

  skipToNextSong(fromBar: number, params: GenerationParams): number {
    if (!this.stream) return fromBar + 16;
    return this.stream.skipToNextSong(fromBar, params);
  }

  dispose(): void {
    this.stream = null;
    this.cache.clear();
    this.lastNote.clear();
    this.paletteEmitted.clear();
  }



  private renderSegment(

    songStream: SongStream,

    form: Form,

    plan: SectionPlan,

    songIndex: number,

    songTitle: string,

    songStart: number,

    songLength: number,

    fromBar: number,

    toBar: number,

    params: GenerationParams,

    out: MusicEvent[],

  ): void {

    if (toBar <= fromBar) return;

    const ctx: LayerContext = {

      seed: this.seed,

      plan,

      prev: form.prev(plan),

      next: form.next(plan),

      fromBar,

      toBar,

      params,

      bank: form.bank,

      cache: this.cache,

    };



    for (const seg of chordSegments(plan)) {

      const abs = plan.startBar + seg.startBar;

      if (abs < fromBar || abs >= toBar) continue;

      const relInSong = abs - songStart;

      const ev: SectionEvent = {

        kind: 'section',

        beat: abs * BEATS_PER_BAR,

        name: plan.name,

        sectionIndex: plan.index,

        key: { ...plan.key },

        chord: toChordSpec(seg.chord),

        energy: energyAt(ctx, abs),

        songIndex,

        songTitle,

        songProgress: songLength > 0 ? clamp01(relInSong / songLength) : 0,

      };

      out.push(ev);

    }



    out.push(...renderAutomation(ctx), ...renderTextureAutomation(ctx));

    out.push(

      ...renderPad(ctx),

      ...renderTextureNotes(ctx),

      ...swingPitchedLayers([...renderBass(ctx), ...renderArp(ctx), ...renderLead(ctx)], plan, params),

      ...renderDrums(ctx),

    );

  }



  private finalize(events: MusicEvent[], startBeat: number, endBeat: number): MusicEvent[] {

    const priority = (e: MusicEvent): number =>

      e.kind === 'palette' ? 0 : e.kind === 'section' ? 1 : e.kind === 'automation' ? 2 : 3;

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

