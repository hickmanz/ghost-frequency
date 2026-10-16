/**
 * Sound Lab: pure helpers for the UI. NO Tone.js, no DOM: safe to import from ui/ and tests.
 * (audio/presets.ts is Tone-free pure data; keep it that way.)
 */
import type { MoodId } from '@shared/index';
import { getBuiltinPreset, getDefaultValue, sanitizeOverrides } from '../audio/presets';
import { TUNING_SCHEMA } from './params';
import type { TuningOverrides, TuningParam } from './schema';

export { getBuiltinPreset, getDefaultValue, sanitizeOverrides };

/** Number -> short readable text (max 4 decimals, no trailing zeros). */
function fmt(n: number): string {
  return String(Number(n.toFixed(4)));
}

let paramIndex: Map<string, TuningParam> | null = null;
function paramOf(key: string): TuningParam | undefined {
  if (!paramIndex) {
    paramIndex = new Map();
    for (const g of TUNING_SCHEMA) for (const p of g.params) paramIndex.set(p.key, p);
  }
  return paramIndex.get(key);
}

/** Label of the option with this value for a 'choice' key (e.g. 2 -> "Sawtooth"); undefined for sliders / unknown values. */
export function getChoiceLabel(key: string, value: number): string | undefined {
  const prm = paramOf(key);
  if (!prm || prm.kind !== 'choice') return undefined;
  return prm.options?.find((o) => o.value === value)?.label;
}

/** Readable text of a tuning value: the option label for choices, a short number otherwise. */
export function formatTuningValue(key: string, value: number): string {
  return getChoiceLabel(key, value) ?? fmt(value);
}

/** Key order: schema order first, then any other (valid) keys alphabetically. */
function orderedKeys(keys: string[]): string[] {
  const order = new Map<string, number>();
  let i = 0;
  for (const g of TUNING_SCHEMA) for (const p of g.params) order.set(p.key, i++);
  return [...keys].sort((a, b) => {
    const ia = order.get(a);
    const ib = order.get(b);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Human-readable text block of the changes versus the built-in defaults, to paste to the lead developer:
 *
 *   Ghost Frequency - Sound Lab tuning
 *   Mood: dreamy
 *   arp.cutoffMax: 4200 -> 6000
 *   ...
 *   JSON: {"arp.cutoffMax":6000}
 *
 * Unknown keys / non-finite values are dropped, values are clamped like the audio engine does, and entries that equal
 * the default are skipped. Choice keys (oscillator shapes) print the option label (arp.wave: Sawtooth -> Square),
 * while the JSON line keeps the numeric option value.
 */
export function formatOverridesForCopy(mood: MoodId, overrides: TuningOverrides): string {
  const clean = sanitizeOverrides(overrides);
  const lines: string[] = [];
  const changed: Record<string, number> = {};
  for (const key of orderedKeys(Object.keys(clean))) {
    const value = clean[key]!;
    const def = getDefaultValue(mood, key);
    if (def === undefined || Math.abs(def - value) < 1e-9) continue;
    lines.push(`${key}: ${formatTuningValue(key, def)} -> ${formatTuningValue(key, value)}`);
    changed[key] = Number(fmt(value));
  }
  const out = ['Ghost Frequency - Sound Lab tuning', `Mood: ${mood}`];
  if (lines.length === 0) {
    out.push('(no changes from the built-in defaults)');
  } else {
    out.push(...lines, `JSON: ${JSON.stringify(changed)}`);
  }
  return out.join('\n');
}
