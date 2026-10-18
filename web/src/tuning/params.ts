import type { TuningGroup, TuningOption, TuningParam } from './schema';

/**
 * Sound Lab parameter list (pure data: no Tone.js, no DOM).
 *
 * Every `key` is a dotted path into MoodPreset (audio/presets.ts) and is LIVE-EFFECTIVE: it is either re-applied to
 * the running audio nodes when a slider moves ("live") or read at the next note ("on next note"); nothing here needs a
 * node rebuild. Oscillator shapes (kind 'choice') and stacked-oscillator counts are applied by the instruments to
 * voices that are idle (i.e. on the next note of that voice), never to a sounding voice. A choice stores the option's
 * numeric `value` (index in WAVES, audio/presets.ts); presets.ts maps it to the preset's wave string in ONE place.
 *
 * Safety: all ranges keep filter cutoffs >= 80 Hz, Q <= 6, delay feedback <= 0.58, gains within the master limiter's
 * comfortable range. presets.ts additionally clamps every incoming override to [min, max] (and keeps each
 * cutoffMin below its cutoffMax).
 *
 * Ranges are chosen around the built-in mood values so the defaults sit well inside the slider.
 * Test: tuning/params.test.ts checks that every key resolves in all moods and each default lies within its range.
 */

type Opts = Partial<Pick<TuningParam, 'unit' | 'scale' | 'visual'>>;

const p = (key: string, label: string, hint: string, min: number, max: number, step: number, opts: Opts = {}): TuningParam => ({
  key,
  label,
  hint,
  min,
  max,
  step,
  ...opts,
});

const HZ: Opts = { unit: 'Hz', scale: 'log' };
const DB: Opts = { unit: 'dB' };
const SEC: Opts = { unit: 's' };
const CENTS: Opts = { unit: 'cents' };
/** Visual hints for the Sound Lab (purely cosmetic): amplitude-envelope params and filter-curve params. */
const ENV_SEC: Opts = { unit: 's', visual: 'envelope' };
const FILT: Opts = { visual: 'filter' };
const FILT_HZ: Opts = { unit: 'Hz', scale: 'log', visual: 'filter' };
const FILT_SEC: Opts = { unit: 's', visual: 'filter' };

type WaveName = 'sine' | 'triangle' | 'sawtooth' | 'square';
const WAVE_OPTIONS: Record<WaveName, TuningOption> = {
  sine: { value: 0, label: 'Sine', wave: 'sine' },
  triangle: { value: 1, label: 'Triangle', wave: 'triangle' },
  sawtooth: { value: 2, label: 'Sawtooth', wave: 'sawtooth' },
  square: { value: 3, label: 'Square', wave: 'square' },
};
/** Option values are the index in WAVES (audio/presets.ts): sine 0, triangle 1, sawtooth 2, square 3. */
const waves = (...names: WaveName[]): TuningOption[] => names.map((n) => WAVE_OPTIONS[n]);
const ALL_WAVES = waves('sine', 'triangle', 'sawtooth', 'square');
const WAVE_HINT = 'Sine = pure/soft, Triangle = hollow/mellow, Sawtooth = bright/rich, Square = hollow/reedy (game-like)';

/** Oscillator shape picker: the stored value is the option's `value`; min/max = lowest/highest option value. */
const waveChoice = (key: string, label: string, hint: string, options: TuningOption[] = ALL_WAVES): TuningParam => ({
  key,
  label,
  hint,
  min: Math.min(...options.map((o) => o.value)),
  max: Math.max(...options.map((o) => o.value)),
  step: 1,
  kind: 'choice',
  options,
  visual: 'wave',
});

const UNISON_HINT = 'More = thicker, richer, more detuned shimmer. 1 = a single clean oscillator';

const LAYER_NAMES = {
  pad: 'Pad',
  arp: 'Arpeggio',
  bass: 'Bass',
  lead: 'Lead',
  drums: 'Percussion',
  texture: 'Texture',
} as const;

const sendParams = (kind: 'reverbSend' | 'delaySend'): TuningParam[] =>
  (Object.keys(LAYER_NAMES) as Array<keyof typeof LAYER_NAMES>).map((layer) =>
    kind === 'reverbSend'
      ? p(
          `fx.reverbSend.${layer}`,
          `${LAYER_NAMES[layer]} reverb`,
          `How much of the ${LAYER_NAMES[layer].toLowerCase()} is sent into the big room sound. Higher = further away and washier. 0 = dry and close`,
          0,
          1,
          0.01,
        )
      : p(
          `fx.delaySend.${layer}`,
          `${LAYER_NAMES[layer]} echo`,
          `How much of the ${LAYER_NAMES[layer].toLowerCase()} is sent into the repeating echo. Higher = more echoes. 0 = none`,
          0,
          1,
          0.01,
        ),
  );

export const TUNING_SCHEMA: TuningGroup[] = [
  {
    id: 'arp',
    label: 'Arpeggio',
    params: [
      waveChoice('arp.wave', 'Wave shape', `The basic tone of each note. ${WAVE_HINT}`),
      p('arp.unison', 'Stacked oscillators (unison)', UNISON_HINT, 1, 5, 1),
      p('arp.cutoffMax', 'Brightness (open)', 'Higher = brighter, buzzier. Lower = darker, softer. This is the top of the range the filter can open to', 800, 9000, 10, FILT_HZ),
      p('arp.cutoffMin', 'Brightness (closed)', 'The darkest the sound can get when the music "closes" the filter. Higher = less dark, less dramatic', 100, 1500, 5, FILT_HZ),
      p('arp.filterOctaves', 'Pluck sparkle', 'How much each note starts bright and then dulls. Higher = more "pew" at the start of each note. 0 = steady tone', 0, 3.5, 0.1, FILT),
      p('arp.filterDecay', 'Sparkle length', 'How long the bright part of each note lasts. Higher = the shimmer lingers', 0.05, 1.5, 0.01, FILT_SEC),
      p('arp.attack', 'Softness', 'Higher = notes fade in gently. Lower = notes start sharp and clicky', 0.002, 0.2, 0.002, ENV_SEC),
      p('arp.decay', 'Note length', 'Higher = notes ring out longer. Lower = short, plucky notes', 0.1, 1.5, 0.01, ENV_SEC),
      p('arp.release', 'Tail length', 'How long each note keeps fading after it ends. Higher = more overlap and shimmer', 0.1, 2.5, 0.01, ENV_SEC),
      p('arp.spread', 'Width / thickness', 'Higher = fatter, more shimmery and detuned. Lower = thinner and cleaner', 0, 60, 1, CENTS),
      p('arp.chorusWet', 'Shimmer', 'Higher = more swirly, wobbling doubled sound. Lower = plain and direct', 0, 1, 0.01),
      p('arp.q', 'Resonance', 'Higher = a more nasal, "wah" ring. Lower = smooth and natural', 0.5, 6, 0.1, FILT),
      p('arp.panDepth', 'Left/right sway', 'Higher = the notes drift further between the left and right speakers. 0 = stays centered', 0, 1, 0.01),
      p('arp.levelDb', 'Volume trim', 'Louder or quieter in the mix (before the main Arp fader)', -18, 6, 0.5, DB),
    ],
  },
  {
    id: 'lead',
    label: 'Lead',
    params: [
      waveChoice('lead.wave0', 'Main voice wave shape', `The tone of the main (thick) voice. ${WAVE_HINT}`),
      p('lead.unison0', 'Main voice stacked oscillators (unison)', UNISON_HINT, 1, 4, 1),
      waveChoice('lead.wave1', 'Second voice wave shape', `The tone of the second, slightly off-pitch voice. ${WAVE_HINT}`),
      p('lead.cutoffMax', 'Brightness (open)', 'Higher = brighter, more cutting. Lower = darker, mellower. This is the top of the range the filter can open to', 1200, 9000, 10, FILT_HZ),
      p('lead.cutoffMin', 'Brightness (closed)', 'The darkest the sound can get when the music "closes" the filter. Higher = less dark', 150, 2000, 5, FILT_HZ),
      p('lead.attack', 'Fade-in', 'Higher = each note swells in slowly. Lower = notes start right away', 0.005, 1, 0.005, ENV_SEC),
      p('lead.release', 'Tail length', 'How long each note keeps fading after it ends. Higher = dreamier, more overlap', 0.1, 4, 0.05, ENV_SEC),
      p('lead.portamento', 'Glide', 'Higher = notes slide into each other like a singing voice. 0 = notes jump directly', 0, 0.4, 0.005, SEC),
      p('lead.vibratoAmount', 'Wobble depth', 'Higher = a stronger pitch wobble (like a singer holding a note). 0 = perfectly steady', 0, 0.6, 0.01),
      p('lead.vibratoRate', 'Wobble speed', 'Higher = a faster wobble. Lower = a slow, lazy wobble', 2, 8, 0.1, { unit: 'Hz' }),
      p('lead.vibratoDelay', 'Wobble delay', 'How long a note stays steady before the wobble begins. Higher = wobble only on long notes', 0, 2.5, 0.05, SEC),
      p('lead.vibratoFade', 'Wobble fade-in', 'How slowly the wobble grows to full strength. Higher = more gradual', 0.1, 4, 0.05, SEC),
      p('lead.harmonicity', 'Second voice detune', 'The lead is two voices. 1.000 = identical (thinner). Higher = the second voice drifts off-pitch for a thicker, wobblier sound', 1, 1.02, 0.0005, { unit: '×' }),
      p('lead.sawDb', 'Main voice level', 'Volume of the main voice. Lower = quieter, leaving more of the second voice', -24, 3, 0.5, DB),
      p('lead.squareDb', 'Second voice level', 'Volume of the second, slightly off-pitch voice. Higher = thicker and edgier. Lower = cleaner', -30, 0, 0.5, DB),
      p('lead.chorusWet', 'Shimmer', 'Higher = more swirly, wobbling doubled sound. Lower = plain and direct', 0, 1, 0.01),
      p('lead.levelDb', 'Volume trim', 'Louder or quieter in the mix (before the main Lead fader)', -18, 6, 0.5, DB),
    ],
  },
  {
    id: 'pad',
    label: 'Pad',
    params: [
      waveChoice('pad.baseType', 'Wave shape', `The basic tone of the chords. ${WAVE_HINT}`),
      p('pad.unison', 'Stacked oscillators (unison)', UNISON_HINT, 1, 5, 1),
      p('pad.cutoffMax', 'Brightness (open)', 'Higher = brighter, airier. Lower = darker, warmer. This is the top of the range the filter can open to', 800, 10000, 10, FILT_HZ),
      p('pad.cutoffMin', 'Brightness (closed)', 'The darkest the sound can get when the music "closes" the filter. Higher = less dark', 100, 1500, 5, FILT_HZ),
      p('pad.attack', 'Swell time', 'How slowly each chord fades in. Higher = a long, slow swell. Lower = chords arrive quickly', 0.1, 6, 0.05, ENV_SEC),
      p('pad.release', 'Tail length', 'How long each chord keeps fading after it ends. Higher = a long, ghostly wash', 0.3, 8, 0.1, ENV_SEC),
      p('pad.spread', 'Width / thickness', 'Higher = fatter and more detuned (lush, a bit seasick). Lower = pure and focused', 0, 70, 1, CENTS),
      p('pad.chorusWet', 'Shimmer', 'Higher = more swirly, wobbling doubled sound. Lower = plain and direct', 0, 1, 0.01),
      p('pad.lfoRate', 'Brightness drift speed', 'How fast the sound slowly brightens and darkens by itself. Higher = faster breathing', 0.01, 0.5, 0.005, { unit: 'Hz', scale: 'log' }),
      p('pad.lfoDepthCents', 'Brightness drift amount', 'How far the sound drifts brighter and darker. Higher = more movement. 0 = static', 0, 1000, 10, CENTS),
      p('pad.width', 'Stereo width', 'Higher = wider, surrounding sound. Lower = narrower and more centered', 0.3, 1, 0.01),
      p('pad.levelDb', 'Volume trim', 'Louder or quieter in the mix (before the main Pad fader)', -18, 6, 0.5, DB),
    ],
  },
  {
    id: 'bass',
    label: 'Bass',
    params: [
      waveChoice('bass.wave', 'Wave shape', 'The basic tone of the bass. Triangle = round/soft, Sawtooth = bright/growly, Square = hollow/reedy (game-like)', waves('triangle', 'sawtooth', 'square')),
      waveChoice('bass.subWave', 'Sub wave shape', 'The very low tone underneath. Sine = pure, deep weight. Triangle = a little more edge so it is easier to hear on small speakers', waves('sine', 'triangle')),
      p('bass.cutoffMax', 'Brightness (open)', 'Higher = more bite and growl. Lower = rounder, deeper. This is the top of the range the filter can open to', 300, 2500, 10, FILT_HZ),
      p('bass.cutoffMin', 'Brightness (closed)', 'The darkest the bass can get when the music "closes" the filter. Higher = less dark', 80, 400, 5, FILT_HZ),
      p('bass.filterOctaves', 'Pluck punch', 'How much each note starts bright and then gets round. Higher = more "wow" at the start of the note', 0, 3.5, 0.1, FILT),
      p('bass.ampDecay', 'Note length', 'Higher = notes ring out longer. Lower = short and tight', 0.05, 1, 0.01, ENV_SEC),
      p('bass.glide', 'Glide', 'Higher = notes slide into each other. 0 = notes jump directly', 0, 0.3, 0.005, SEC),
      p('bass.drive', 'Grit', 'Higher = more crunchy, gritty distortion. 0 = clean and smooth', 0, 0.8, 0.01),
      p('bass.subDb', 'Deep rumble', 'Volume of the very low, pure tone underneath. Higher = more sub-bass weight', -24, 2, 0.5, DB),
      p('bass.levelDb', 'Volume trim', 'Louder or quieter in the mix (before the main Bass fader)', -18, 6, 0.5, DB),
    ],
  },
  {
    id: 'drums',
    label: 'Percussion',
    params: [
      p('drums.kickDb', 'Kick level', 'Volume of the bass drum. Higher = bigger thump', -30, 0, 0.5, DB),
      p('drums.kickDecay', 'Kick length', 'Higher = a longer, boomier kick. Lower = a short, tight thud', 0.1, 0.8, 0.01, SEC),
      p('drums.kickHz', 'Kick pitch', 'Higher = a higher, punchier kick. Lower = a deeper rumble', 35, 80, 1, HZ),
      p('drums.kickPitchOct', 'Kick punch', 'How much the kick "drops" in pitch at the start. Higher = more beater-like click and punch', 0.5, 3.5, 0.1),
      p('drums.snareDb', 'Snare level', 'Volume of the snare. Higher = a louder crack', -30, -2, 0.5, DB),
      p('drums.snareSizzleDb', 'Snare sizzle', 'The bright white-noise "tss" on top of the snare (80s drum-machine hiss). Higher = hissier, lower = a darker, rounder snare', -48, -8, 0.5, DB),
      p('drums.snareTailHz', 'Snare tail brightness', 'Tone of the short gated-reverb burst after the snare. Higher = a bright "tssh", lower = a soft whoosh', 2000, 10000, 50, HZ),
      p('drums.clapDb', 'Clap level', 'Volume of the hand-clap. Higher = more claps', -36, -6, 0.5, DB),
      p('drums.hatDb', 'Hi-hat level', 'Volume of the tick-tick cymbal sound. Higher = busier and brighter', -40, -12, 0.5, DB),
      p('drums.hatHpHz', 'Hi-hat brightness', 'Higher = thinner, sizzlier hats. Lower = fuller, breathier hats', 3000, 11000, 50, HZ),
      p('drums.ceilingHz', 'Overall brightness', 'Higher = crisp and airy drums. Lower = dull, muffled and vintage', 3000, 16000, 50, HZ),
      p('drums.levelDb', 'Volume trim', 'Louder or quieter in the mix (before the main Percussion fader)', -12, 9, 0.5, DB),
    ],
  },
  {
    id: 'texture',
    label: 'Ambient Texture',
    params: [
      p('texture.pinkDb', 'Airy hiss', 'Volume of the soft "shhh" ambient noise. Higher = more air and breath', -30, 3, 0.5, DB),
      p('texture.brownDb', 'Low rumble', 'Volume of the deep, wind-like rumble. Higher = more distant thunder', -30, 3, 0.5, DB),
      p('texture.noiseCutoffMax', 'Noise brightness (open)', 'Higher = brighter, hissier noise. Lower = muffled, like it is behind a wall', 1000, 12000, 50, FILT_HZ),
      p('texture.noiseCutoffMin', 'Noise brightness (closed)', 'The darkest the noise can get. Higher = less dark', 100, 1500, 10, FILT_HZ),
      waveChoice('texture.droneBaseType', 'Drone wave shape', `The tone of the long humming notes. ${WAVE_HINT}`),
      p('texture.droneDb', 'Drone level', 'Volume of the long, humming background notes. Higher = a heavier, more constant hum', -24, 6, 0.5, DB),
      p('texture.droneCutoffMax', 'Drone brightness (open)', 'Higher = a buzzier, brighter hum. Lower = a darker, softer hum', 600, 8000, 20, FILT_HZ),
      p('texture.droneCutoffMin', 'Drone brightness (closed)', 'The darkest the hum can get. Higher = less dark', 80, 800, 5, FILT_HZ),
      p('texture.levelDb', 'Volume trim', 'Louder or quieter in the mix (before the main Texture fader)', -18, 9, 0.5, DB),
    ],
  },
  {
    id: 'fx',
    label: 'Space (Reverb & Delay)',
    params: [
      p('fx.reverbReturnDb', 'Reverb amount', 'The overall volume of the big room / hall sound. Higher = more distant and spacious. Lower = closer and drier', -24, 3, 0.5, DB),
      p('fx.reverbLpHz', 'Reverb brightness', 'Higher = a bright, shiny room. Lower = a dark, muffled cave', 1500, 16000, 50, HZ),
      p('fx.delayFeedback', 'Echo repeats', 'How many times the echo repeats. Higher = a long trail of repeats. Lower = just one or two', 0.05, 0.58, 0.01),
      p('fx.delayLpHz', 'Echo brightness', 'Higher = repeats stay bright. Lower = each repeat gets darker and fades into the haze', 800, 12000, 50, HZ),
      p('fx.delayReturnDb', 'Echo volume', 'The overall volume of the echoes. Higher = louder repeats. Lower = subtle', -24, 3, 0.5, DB),
      ...sendParams('reverbSend'),
      ...sendParams('delaySend'),
    ],
  },
];
