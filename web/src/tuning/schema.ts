import type { LayerId } from '@shared/index';

/**
 * Sound Lab tuning contract. PURE DATA / TYPES: no Tone.js, no DOM. Imported by both audio/ and ui/.
 *
 * An override key is a dotted path into the active MoodPreset (see audio/presets.ts),
 * e.g. 'arp.cutoffMax', 'lead.vibratoAmount', 'fx.reverbSend.arp', 'fx.delayFeedback'.
 * Overrides are stored per mood and merged over the built-in preset by getPreset(mood).
 */
export type TuningOverrides = Record<string, number>;

export interface TuningParam {
  /** dotted path into MoodPreset */
  key: string;
  label: string;
  /** one short plain-language hint, for non-musicians, e.g. "Higher = brighter / buzzier" */
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** 'log' for frequency-like params so sliders feel even */
  scale?: 'linear' | 'log';
  /**
   * 'slider' (default) = continuous number. 'choice' = pick one of `options`; the override value is the
   * option's numeric `value` (stored as a number like everything else). For choices, min/max/step are
   * informational (min = lowest option value, max = highest, step = 1) and the UI renders buttons, not a slider.
   * The audio side maps the numeric value to the underlying preset field (e.g. oscillator type string).
   */
  kind?: 'slider' | 'choice';
  options?: TuningOption[];
  /**
   * Optional hint to the UI about which visual to draw for this param (purely cosmetic):
   * 'wave' = oscillator shape preview, 'envelope' = part of the amplitude envelope (attack/decay/sustain/release),
   * 'filter' = part of the low-pass filter curve (cutoff range / Q / filterOctaves).
   */
  visual?: 'wave' | 'envelope' | 'filter';
}

export interface TuningOption {
  value: number;
  label: string;
  /** hint for the UI wave preview: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse' (+ optional 'fat' stacking flag) */
  wave?: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse';
  fat?: boolean;
}

export type TuningGroupId = LayerId | 'fx';

export interface TuningGroup {
  id: TuningGroupId;
  label: string;
  params: TuningParam[];
}

/**
 * The list of live-tunable parameters, in display order.
 * ONLY include parameters that really take effect while sounding (no oscillator type / voice count).
 * Filled in by the audio side (web/src/tuning/params.ts re-exports into this); the UI just renders it.
 */
export { TUNING_SCHEMA } from './params';
