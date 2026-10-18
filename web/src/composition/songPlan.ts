/**
 * Discrete songs: each song has its own tempo, key, progression, motif bank, drum character, palette and section schedule.
 */
import { DRUM_KIT_IDS, type DrumKitId, type GenerationParams, type KeySpec, type MoodId } from '@shared/index';
import { generateProgression, templatesOf, type Progression } from './harmony';
import { Form, LOCK_BARS, PLAN_KEEP_BARS } from './form';
import { createHistory, createMotifBank, type MotifHistory } from './motifs';
import { MOODS, type ArpFamily, type DrumStyle, type SectionName } from './moods';
import { paletteDistinct, type SongPalette } from './palettes';
import { chance, int, stream, weightedPick } from './rng';
import { mod12 } from './theory';
import { songTitle } from './titles';
import { driveLengthScale, formDrive } from './steer';
import type { SectionPlan } from './plan';
import { planEnd } from './plan';

export type SongArrangement = 'classic' | 'compact' | 'extended' | 'ambient' | 'driving';

export interface SongSectionSlot {
  name: SectionName;
  bars: number;
}

export interface SongPlan {
  index: number;
  title: string;
  mood: MoodId;
  startBar: number;
  lengthBars: number;
  tempo: number;
  key: KeySpec;
  homeProgression: Progression;
  schedule: SongSectionSlot[];
  drumStyle: DrumStyle;
  /** 0..~0.6 song swing for the rhythm layers (scaled live by the Swing knob) */
  swing: number;
  /** index into DRUM_KIT_IDS */
  kit: number;
  /** kit tuning in semitones */
  kitTune: number;
  initialArpFamily: ArpFamily;
  palette: SongPalette;
  carryMotifId?: number;
}

export const songEnd = (s: SongPlan): number => s.startBar + s.lengthBars;

const ARRANGEMENTS: Record<SongArrangement, readonly SectionName[]> = {
  classic: ['Intro', 'Drift', 'Build', 'Peak', 'Breakdown', 'Outro'],
  compact: ['Intro', 'Drift', 'Build', 'Outro'],
  extended: ['Intro', 'Drift', 'Build', 'Peak', 'Breakdown', 'Peak', 'Outro'],
  ambient: ['Intro', 'Drift', 'Drift', 'Breakdown', 'Outro'],
  driving: ['Intro', 'Build', 'Peak', 'Breakdown', 'Build', 'Peak', 'Outro'],
};

function arrangementWeights(drive: number): ReadonlyArray<readonly [SongArrangement, number]> {
  const calm = 1 - drive;
  return [
    ['classic', 4],
    ['compact', 1 + calm * 2],
    ['extended', 1 + drive * 2],
    ['ambient', 2.5 * calm * calm],
    ['driving', Math.max(0, drive - 0.45) * 10],
  ];
}

type Weights<T> = ReadonlyArray<readonly [T, number]>;

const DRUM_FAMILIES: Record<MoodId, Weights<DrumStyle>> = {
  dreamy: [['minimal', 3], ['backbeat', 2], ['fourfloor', 2], ['gated', 1], ['halftime', 1]],
  sunrise: [['backbeat', 3], ['fourfloor', 3], ['gated', 2], ['shuffle', 0.5]],
  nostalgic: [['fourfloor', 3], ['backbeat', 3], ['gated', 2], ['electro', 1], ['breakbeat', 1], ['shuffle', 1]],
  drive: [['fourfloor', 4], ['gated', 2], ['backbeat', 1.5], ['electro', 1]],
  chase: [['electro', 3], ['breakbeat', 3], ['fourfloor', 1.5], ['halftime', 1]],
  dark: [['halftime', 3], ['electro', 2], ['minimal', 2], ['breakbeat', 1]],
  noir: [['shuffle', 3], ['halftime', 2], ['minimal', 1.5], ['backbeat', 1]],
  space: [['minimal', 3], ['halftime', 2], ['gated', 1]],
};

/** Swing range per family; most synthwave sits close to straight. */
const FAMILY_SWING: Record<DrumStyle, readonly [number, number]> = {
  fourfloor: [0, 0.15],
  backbeat: [0, 0.2],
  halftime: [0.05, 0.3],
  electro: [0.1, 0.35],
  breakbeat: [0.15, 0.4],
  gated: [0, 0.1],
  shuffle: [0.4, 0.6],
  minimal: [0, 0.2],
};

const DRUM_KITS: Record<MoodId, Weights<DrumKitId>> = {
  dreamy: [['linn', 3], ['soft', 3], ['dmx', 2], ['tape', 2], ['simmons', 1]],
  sunrise: [['linn', 3], ['dmx', 2], ['tr909', 2], ['simmons', 1]],
  nostalgic: [['linn', 3], ['dmx', 3], ['tr909', 2], ['tr808', 2], ['simmons', 1], ['tape', 1]],
  drive: [['tr909', 3], ['linn', 3], ['dmx', 2], ['simmons', 1]],
  chase: [['tr808', 3], ['dmx', 2], ['tr909', 2], ['simmons', 1]],
  dark: [['tr808', 3], ['tape', 3], ['simmons', 2], ['dmx', 1], ['tr909', 1]],
  noir: [['tape', 3], ['soft', 2], ['tr808', 2], ['linn', 1]],
  space: [['soft', 3], ['tape', 2], ['linn', 1], ['tr808', 1]],
};

/** Some grooves really want a particular machine. */
const FAMILY_KIT: Partial<Record<DrumStyle, readonly [DrumKitId, number]>> = {
  electro: ['tr808', 0.6],
  fourfloor: ['tr909', 0.35],
  gated: ['linn', 0.4],
};

function contrastOf(params: GenerationParams): number {
  return Math.min(1, Math.max(0, params.contrast ?? 0.5));
}

function sectionBars(name: SectionName, rng: ReturnType<typeof stream>, moodAmbient: boolean, drive: number): number {
  const base =
    name === 'Intro' || name === 'Outro'
      ? chance(rng, 0.5 + drive * 0.4)
        ? 16
        : 32
      : name === 'Peak'
        ? weightedPick(rng, [[24, 2], [32, 3], [48, 1]] as const)
        : weightedPick(rng, [[16, 3], [24, 2], [32, 1]] as const);
  const padded = moodAmbient && name === 'Drift' ? Math.min(64, base + 16) : base;
  // Peaks stretch a little with drive; everything else shrinks
  const scale = name === 'Peak' ? 0.9 + drive * 0.3 : driveLengthScale(drive);
  return Math.max(8, Math.min(64, Math.round((padded * scale) / 8) * 8));
}

function buildSchedule(arr: SongArrangement, rng: ReturnType<typeof stream>, moodId: MoodId, drive: number): SongSectionSlot[] {
  const names = ARRANGEMENTS[arr];
  const ambient = moodId === 'space';
  return names.map((name) => ({ name, bars: sectionBars(name, rng, ambient, drive) }));
}

function pickTempo(
  seed: number,
  songIndex: number,
  mood: MoodId,
  prev: number | undefined,
  contrast: number,
): number {
  const [lo, hi] = MOODS[mood].tempo;
  const rng = stream(seed, 'song-tempo', songIndex);
  let t = int(rng, lo, hi);
  const minDelta = Math.round(4 + contrast * 8);
  for (let i = 0; i < 8 && prev !== undefined && Math.abs(t - prev) < minDelta; i++) t = int(rng, lo, hi);
  return t;
}

/** Playback tempo: the song's base pick shifted by energy (0.5 = base), rounded to 2 BPM so chaos wobble doesn't ramp every bar. */
export function songTempo(song: SongPlan, energy: number): number {
  const [lo, hi] = MOODS[song.mood].tempo;
  const shift = (Math.min(1, Math.max(0, energy)) - 0.5) * (hi - lo + 24);
  return Math.min(170, Math.max(50, Math.round((song.tempo + shift) / 2) * 2));
}

function pickKey(
  seed: number,
  songIndex: number,
  mood: MoodId,
  prev: KeySpec | undefined,
  contrast: number,
): KeySpec {
  const moodCfg = MOODS[mood];
  const rng = stream(seed, 'song-key', songIndex);
  if (!prev) {
    const tonic = weightedPick(
      rng,
      moodCfg.tonicWeights.map((w, i) => [i, w] as const),
    );
    const scale = weightedPick(rng, moodCfg.scales);
    return { tonic, scale };
  }
  const jump = weightedPick(rng, [
    [5, 3],
    [7, 3],
    [2, 2],
    [-2, 2],
    [3, 1],
    [-3, 1],
  ] as const);
  const steps = contrast > 0.55 ? jump : Math.sign(jump) * Math.min(Math.abs(jump), 2);
  const allowed = moodCfg.scales.map((s) => s[0]);
  let tonic = mod12(prev.tonic + steps);
  let scale = prev.scale;
  if (!allowed.includes(scale) || chance(rng, 0.2 + contrast * 0.3)) {
    scale = weightedPick(rng, moodCfg.scales);
    tonic = weightedPick(
      rng,
      moodCfg.tonicWeights.map((w, i) => [i, w] as const),
    );
  }
  return { tonic, scale };
}

function pickDrumStyle(mood: MoodId, rng: ReturnType<typeof stream>, avoid?: DrumStyle): DrumStyle {
  const weights = DRUM_FAMILIES[mood].map(([f, w]) => [f, f === avoid ? w * 0.15 : w] as const);
  return weightedPick(rng, weights);
}

function pickKit(mood: MoodId, family: DrumStyle, rng: ReturnType<typeof stream>, avoid?: number): number {
  const affinity = FAMILY_KIT[family];
  let id: DrumKitId;
  if (affinity && chance(rng, affinity[1])) id = affinity[0];
  else {
    const weights = DRUM_KITS[mood].map(([k, w]) => [k, DRUM_KIT_IDS.indexOf(k) === avoid ? w * 0.3 : w] as const);
    id = weightedPick(rng, weights);
  }
  return DRUM_KIT_IDS.indexOf(id);
}

function pickArp(mood: MoodId, rng: ReturnType<typeof stream>, avoid?: ArpFamily): ArpFamily {
  const weights = mood.arp.families.map(([f, w]) => [f, avoid && f === avoid ? w * 0.25 : w] as const);
  return weightedPick(rng, weights);
}

export function planSong(
  seed: number,
  index: number,
  startBar: number,
  params: GenerationParams,
  prev?: SongPlan,
): SongPlan {
  const mood = params.mood;
  const moodCfg = MOODS[mood];
  const contrast = contrastOf(params);
  const rng = stream(seed, 'song', index, mood);
  const drive = formDrive(params);
  const arrangement = weightedPick(rng, arrangementWeights(drive));
  const schedule = buildSchedule(arrangement, stream(seed, 'song-sched', index), mood, drive);
  const lengthBars = schedule.reduce((a, s) => a + s.bars, 0);
  const key = pickKey(seed, index, mood, prev?.key, contrast);
  const prog = generateProgression(key, MOODS[mood], stream(seed, 'song-prog', index));
  const tempo = pickTempo(seed, index, mood, prev?.tempo, contrast);
  const drumRng = stream(seed, 'song-drum', index);
  const drumStyle = pickDrumStyle(mood, drumRng, prev?.drumStyle);
  const [swLo, swHi] = FAMILY_SWING[drumStyle];
  const swing = swLo + drumRng.next() * (swHi - swLo);
  const kit = pickKit(mood, drumStyle, drumRng, prev?.kit);
  const kitTune = int(drumRng, -3, 3);
  const sampled = paletteDistinct(mood, seed, index, contrast, prev?.palette.paletteId);
  const palette: SongPalette = {
    paletteId: sampled.paletteId,
    overrides: { ...sampled.overrides, 'drums.kit': kit, 'drums.tune': kitTune },
  };
  const initialArpFamily = pickArp(moodCfg, stream(seed, 'song-arp', index), prev?.initialArpFamily);

  return {
    index,
    title: songTitle(seed, index),
    mood,
    startBar,
    lengthBars,
    tempo,
    key,
    homeProgression: prog,
    schedule,
    drumStyle,
    swing,
    kit,
    kitTune,
    initialArpFamily,
    palette,
    carryMotifId: prev && chance(rng, 0.25 + contrast * 0.2) ? 0 : undefined,
  };
}

/** Lazily planned song stream; each song owns a section Form. */
export class SongStream {
  readonly seed: number;
  readonly songs: SongPlan[] = [];
  readonly history: MotifHistory = createHistory();
  private forms = new Map<number, Form>();
  private nextGlobalSectionIndex = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  songForBar(bar: number, params: GenerationParams): SongPlan {
    while (this.songs.length === 0 || songEnd(this.songs[this.songs.length - 1]!) <= bar) {
      const last = this.songs[this.songs.length - 1];
      this.songs.push(planSong(this.seed, last ? last.index + 1 : 0, last ? songEnd(last) : 0, params, last));
      if (this.songs.length > 48) this.songs.splice(0, this.songs.length - 48);
    }
    for (let i = this.songs.length - 1; i >= 0; i--) if (this.songs[i]!.startBar <= bar) return this.songs[i]!;
    return this.songs[0]!;
  }

  formForSong(song: SongPlan, params: GenerationParams): Form {
    let form = this.forms.get(song.index);
    if (!form) {
      if (song.index > 0) {
        const prevForm = this.forms.get(song.index - 1);
        const last = prevForm?.plans[prevForm.plans.length - 1];
        if (last) this.nextGlobalSectionIndex = last.index + 1;
      }
      form = new Form(this.seed, params, song, this.nextGlobalSectionIndex, this.history);
      this.forms.set(song.index, form);
    }
    return form;
  }

  sectionForBar(bar: number, params: GenerationParams): { song: SongPlan; form: Form; plan: SectionPlan } {
    const song = this.songForBar(bar, params);
    const form = this.formForSong(song, params);
    const plan = form.sectionForBar(bar, params);
    return { song, form, plan };
  }

  ensureNext(plan: SectionPlan, params: GenerationParams): SectionPlan {
    const song = this.songForBar(plan.startBar, params);
    const form = this.formForSong(song, params);
    return form.ensureNext(plan, params);
  }

  /**
   * Target bar for skip: first bar of the next song after `fromBar`.
   * If already at a song boundary, skips the song that starts there.
   */
  skipToNextSong(fromBar: number, params: GenerationParams): number {
    const song = this.songForBar(fromBar, params);
    const rel = fromBar - song.startBar;
    if (rel > 0 && rel < song.lengthBars) {
      const newLen = Math.max(4, Math.ceil(rel / 4) * 4);
      if (newLen < song.lengthBars) {
        song.lengthBars = newLen;
        song.schedule = trimSchedule(song.schedule, newLen);
        this.forms.get(song.index)?.truncateToLength(newLen);
      }
    }
    let target = songEnd(song);
    if (fromBar >= target - 1e-6) {
      const next = this.songForBar(target, params);
      target = songEnd(next);
    }
    this.songForBar(target, params);
    return target;
  }

  onMoodChange(plan: SectionPlan, renderedThrough: number, params: GenerationParams): void {
    const song = this.songForBar(plan.startBar, params);
    this.formForSong(song, params).onMoodChange(plan, renderedThrough, params);
  }

  pruneBehind(renderedThroughBar: number, keepBars = PLAN_KEEP_BARS): void {
    for (const form of this.forms.values()) form.pruneBehind(renderedThroughBar, keepBars);
  }

  /** Drop songs after current and shorten the active song (mood change). */
  wrapUpSong(bar: number): void {
    const i = this.songs.findIndex((s) => bar >= s.startBar && bar < songEnd(s));
    if (i < 0) return;
    this.songs.splice(i + 1);
    for (const [idx] of [...this.forms.entries()]) if (idx > this.songs[i]!.index) this.forms.delete(idx);
    const song = this.songs[i]!;
    const rel = bar - song.startBar;
    const newLen = Math.ceil((rel + 2) / 4) * 4;
    if (newLen >= song.lengthBars) return;
    song.lengthBars = newLen;
    song.schedule = trimSchedule(song.schedule, newLen);
    const form = this.forms.get(song.index);
    form?.truncateToLength(newLen);
  }

  allSections(): SectionPlan[] {
    const out: SectionPlan[] = [];
    for (const form of this.forms.values()) out.push(...form.plans);
    out.sort((a, b) => a.startBar - b.startBar);
    return out;
  }

  advanceSectionIndex(count: number): void {
    this.nextGlobalSectionIndex += count;
  }
}

function trimSchedule(schedule: SongSectionSlot[], maxBars: number): SongSectionSlot[] {
  const out: SongSectionSlot[] = [];
  let pos = 0;
  for (const slot of schedule) {
    if (pos >= maxBars) break;
    const bars = Math.min(slot.bars, maxBars - pos);
    out.push({ name: slot.name, bars });
    pos += bars;
  }
  return out;
}

export { LOCK_BARS, PLAN_KEEP_BARS };
