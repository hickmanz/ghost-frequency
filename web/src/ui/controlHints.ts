import type { MoodId } from '@shared/index';
import type { VisualMode } from './visualMode';

/** Main lab knobs (steer, params, tone, director). Keys match modKey unless noted. */
export const KNOB_HINTS: Record<string, string> = {
  pace: 'How quickly sections evolve and phrases turn over. Higher = faster form changes.',
  build: 'How strongly the song rises toward peaks and breathes between them.',
  energy: 'Overall intensity: louder hits, fuller drums, and more active layers.',
  contrast: 'How much each new song drifts from the last in timbre and steering.',
  motion: 'Harmonic motion — how often chords change and voices move.',
  colour: 'Harmonic color — extensions, borrowed chords, and brighter changes.',
  complexity: 'Theory depth: richer harmony, trickier lines, and less predictable parts.',
  variation: 'How much riffs and patterns mutate instead of repeating the same thing.',
  swing: 'Timing feel from straight grid to lazy, pushed off-beats.',
  busy: 'Note and hit density across drums, arp, bass, and fills.',
  sync: 'Tighten arp rhythm to the groove; high = steadier arp, fewer wild pattern hops.',
  feel: 'Groove weight and looseness — pulse strength and humanized timing.',
  lead: 'How often and how busily the lead melody plays when it is in.',
  recall: 'Bring back earlier motifs and themes later in the song.',
  register: 'Lead pitch height — higher = brighter, higher-register lead.',
  bright: 'Live tone: brighter filters and presence on synths.',
  grit: 'Live tone: saturation, drive, and edge.',
  space: 'Live tone: reverb size and stereo width.',
  wow: 'Live tone: tape-style pitch wobble and drift.',
  crush: 'Live tone: bit crush and lo-fi digital grit.',
  'chaos.amount': 'Director wobble — how far unpinned knobs drift from your settings.',
  'chaos.rate': 'Director wobble — how often those drifts update.',
};

export const DIRECTOR_GROUP_HINTS: Record<'form' | 'harmony' | 'rhythm' | 'melody' | 'tone', string> = {
  form: 'Let Director modulate Form knobs (pace, build, energy, contrast).',
  harmony: 'Let Director modulate Harmony knobs (motion, colour, complexity, variation).',
  rhythm: 'Let Director modulate Rhythm knobs (swing, busy, sync, feel).',
  melody: 'Let Director modulate Melody knobs (lead, recall, register).',
  tone: 'Let Director modulate Tone knobs (bright, grit, space, wow, crush).',
};

export const MIXER_HINTS: Record<string, string> = {
  pad: 'Pad synth layer level.',
  arp: 'Arpeggiator layer level.',
  bass: 'Bass layer level.',
  lead: 'Lead melody layer level.',
  drums: 'Drums and percussion level.',
  texture: 'Ambient texture layer level.',
  bell: 'Bell / pluck accent layer level.',
  master: 'Overall output level after all layers.',
};

export const VIBE_SLIDER_HINTS: Record<'brightness' | 'tension' | 'density' | 'groove', string> = {
  brightness: 'Steer toward brighter harmony and timbre (also used for neural conditioning on Python).',
  tension: 'Steer toward sharper harmony and more suspense.',
  density: 'Steer note and hit density without touching every knob manually.',
  groove: 'Steer swing, pocket, and rhythmic feel.',
};

export const MOOD_STATION_HINTS: Record<MoodId, string> = {
  dreamy: 'Lush pads, floating arps, soft major-7 haze.',
  sunrise: 'Bright major anthems, open skies, golden hour.',
  nostalgic: 'Warm analog 80s, bittersweet melodies.',
  drive: 'Fast outrun, pumping octave bass, neon highway.',
  chase: 'Menacing darksynth, gritty bass, electro breaks.',
  dark: 'Minor drones, driving bass, midnight neon.',
  noir: 'Smoky jazz chords, swung beats, rain on glass.',
  space: 'Slow drifting textures, vast reverb.',
};

export const VISUAL_MODE_HINTS: Record<VisualMode, string> = {
  classic: 'Original neon grid visualizer tied to the mix.',
  landscape: 'Wide scrolling landscape driven by the music.',
  spectrogram: 'Frequency view of what you are hearing.',
  timeline: 'Section and arrangement timeline view.',
};

export const SLIDER_HINTS: Record<string, string> = {
  tempo: 'Beats per minute. Turn off Auto to set a fixed BPM.',
};

export function hintForControl(key: string): string | undefined {
  return KNOB_HINTS[key];
}

export function hintForMixer(id: string): string {
  return MIXER_HINTS[id] ?? `${id} level.`;
}
