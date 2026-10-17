/**
 * Shared, versioned music representation.
 * Composition engines (JS now, Python later) emit EventBatch; audio renderers consume it.
 * All timing is in musical beats from song start (beat 0). One bar = timeSig[0] beats (4/4 in v1).
 * This file must stay free of any Tone.js / DOM imports.
 */

export const SCHEMA_VERSION = 1;

export type LayerId = 'pad' | 'arp' | 'bass' | 'lead' | 'drums' | 'texture' | 'bell';
export const LAYER_IDS: readonly LayerId[] = ['pad', 'arp', 'bass', 'lead', 'drums', 'texture', 'bell'];

export type MoodId = 'dreamy' | 'dark' | 'nostalgic' | 'space';
export const MOOD_IDS: readonly MoodId[] = ['dreamy', 'dark', 'nostalgic', 'space'];

export type ScaleName =
  | 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'locrian'
  | 'harmonicMinor';

export interface KeySpec {
  /** Pitch class of tonic, 0 = C ... 11 = B */
  tonic: number;
  scale: ScaleName;
}

export interface ChordSpec {
  /** MIDI pitch of chord root (bass register reference, e.g. 36-47) */
  root: number;
  /** Human label, e.g. "Am9", "Fmaj7" */
  label: string;
  /** Roman numeral / function label, e.g. "i", "VI", "bVII" */
  numeral?: string;
  /** Semitone intervals above root, e.g. [0,3,7,14] */
  intervals: number[];
}

/**
 * Drum layer MIDI mapping (General MIDI subset):
 * 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 49 crash/cymbal-ish, 43 low tom.
 */
export const DRUM = { kick: 36, snare: 38, clap: 39, hatClosed: 42, hatOpen: 46, crash: 49, tom: 43 } as const;

export interface NoteEvent {
  kind: 'note';
  layer: LayerId;
  /** absolute beat from song start */
  beat: number;
  /** duration in beats */
  durBeats: number;
  /** MIDI pitch 0-127 (for drums see DRUM) */
  midi: number;
  /** velocity 0..1 */
  vel: number;
}

/**
 * Normalized automation. value is 0..1 unless noted. Renderer maps to real units.
 *  filter.<layer>   - low-pass cutoff (log-mapped by the instrument)
 *  send.reverb      - reverb send level of the whole mix
 *  send.delay       - delay send level of the whole mix
 *  texture.noise    - noise bed level inside texture layer
 *  master.filter    - master low-pass sweep (1 = fully open); used for transitions
 *  layer.gain.<layer> - transient section-level gain (multiplied with user mixer fader)
 */
export type AutomationTarget =
  | 'filter.pad' | 'filter.arp' | 'filter.bass' | 'filter.lead' | 'filter.texture' | 'filter.bell'
  | 'send.reverb' | 'send.delay' | 'texture.noise' | 'master.filter'
  | 'layer.gain.pad' | 'layer.gain.arp' | 'layer.gain.bass'
  | 'layer.gain.lead' | 'layer.gain.drums' | 'layer.gain.texture' | 'layer.gain.bell'
  | 'duck.pad' | 'duck.texture'
  /** Sound Lab preset path; value 0..1 mapped to that param's range (Auteur engine). */
  | `param.${string}`;

export interface AutomationEvent {
  kind: 'automation';
  target: AutomationTarget;
  beat: number;
  value: number;
  /** ramp length in beats (linear ramp from previous value); 0/undefined = jump */
  rampBeats?: number;
}

/** Marks a musical section / chord boundary. Used for UI display and arrangement info. */
export interface SectionEvent {
  kind: 'section';
  beat: number;
  /** e.g. "Intro", "Drift", "Build", "Peak", "Breakdown" */
  name: string;
  sectionIndex: number;
  key: KeySpec;
  /** current chord at this beat (emitted at every chord change) */
  chord?: ChordSpec;
  /** 0..1 effective energy for this section */
  energy: number;
}

/** Reserved for future external audio generation (ML textures etc). Renderers may ignore in v1. */
export interface AudioClipEvent {
  kind: 'audioClip';
  layer: LayerId;
  beat: number;
  durBeats: number;
  uri: string;
  gain?: number;
}

export type MusicEvent = NoteEvent | AutomationEvent | SectionEvent | AudioClipEvent;

/** Contiguous chunk of music covering [startBeat, endBeat). Batches are produced in order, no gaps. */
export interface EventBatch {
  version: number;
  startBeat: number;
  endBeat: number;
  /** BPM in effect from startBeat */
  tempo: number;
  timeSig: [number, number];
  events: MusicEvent[];
}
