/**
 * Timbral score for the Auteur engine: replaces LocalEngine macro automation and drives
 * Sound Lab parameters over time via `param.*` automation targets.
 */
import type { AutomationEvent, AutomationTarget, GenerationParams } from '@shared/index';
import { BEATS_PER_BAR } from '../composition/layers/context';
import { clamp, clamp01 } from '../composition/theory';
import { int, stream } from '../composition/rng';
import { AUTEUR_PARAM_KEYS } from '../tuning/paramAutomation';
import { filterOpenness, reverbLevel, delayLevel } from '../composition/automation';

function ev(target: AutomationTarget, beat: number, value: number, rampBeats = 0): AutomationEvent {
  return { kind: 'automation', target, beat, value: clamp(value, 0, 1), rampBeats };
}

function paramEv(key: (typeof AUTEUR_PARAM_KEYS)[number], beat: number, value: number, rampBeats = 0): AutomationEvent {
  return ev(`param.${key}` as AutomationTarget, beat, clamp01(value), rampBeats);
}

function drift(bar: number, period: number, phase: number): number {
  return Math.sin((2 * Math.PI * bar) / period + phase);
}

/** Normalized 0..1 sweep for a param key over the piece. */
function paramSweep(seed: number, key: string, bar: number, energy: number, variation: number): number {
  const phase = int(stream(seed, 'auteur', key), 0, 1000) / 1000;
  const period = 24 + int(stream(seed, 'auteur_p', key), 0, 40);
  const base = 0.35 + energy * 0.25 + variation * 0.15;
  return clamp01(base + 0.28 * drift(bar, period, phase * Math.PI * 2));
}

export function buildAuteurAutomation(
  fromBar: number,
  toBar: number,
  params: GenerationParams,
  seed: number,
): AutomationEvent[] {
  const out: AutomationEvent[] = [];
  const e = clamp01(params.energy);
  const v = clamp01(params.variation);

  for (let bar = fromBar; bar < toBar; bar++) {
    const beat = bar * BEATS_PER_BAR;
    const secPhase = Math.floor(bar / 16);

    if (bar === fromBar && fromBar === 0) {
      out.push(ev('master.filter', beat, 1));
      for (const l of ['pad', 'arp', 'bass', 'lead', 'drums', 'texture'] as const) {
        out.push(ev(`layer.gain.${l}` as AutomationTarget, beat, 1));
      }
    }

    if (bar % 16 === 0) {
      out.push(ev('master.filter', beat, 0.72, 4));
      out.push(ev('master.filter', beat + 4, 1, 12));
    }

    out.push(ev('filter.pad', beat, filterOpenness('pad', e, bar), 4));
    out.push(ev('filter.arp', beat, filterOpenness('arp', e, bar), 4));
    out.push(ev('filter.bass', beat, filterOpenness('bass', e, bar), 4));
    out.push(ev('filter.lead', beat, filterOpenness('lead', e, bar), 4));
    out.push(ev('send.reverb', beat, reverbLevel(0.55 + v * 0.2, e, bar), 8));
    out.push(ev('send.delay', beat, delayLevel(0.45 + v * 0.15, e, bar), 8));

    out.push(paramEv('pad.attack', beat, paramSweep(seed, 'pad.attack', bar, e, v), 8));
    out.push(paramEv('pad.release', beat, paramSweep(seed, 'pad.release', bar, e, v), 8));
    out.push(paramEv('pad.chorusWet', beat, 0.25 + v * 0.45 + 0.1 * drift(bar, 19, 0.2), 6));
    out.push(paramEv('pad.spread', beat, 0.3 + e * 0.5, 8));

    if (bar % 8 === 0) {
      const waveStep = (secPhase + int(stream(seed, 'pw', bar), 0, 3)) % 4;
      out.push(paramEv('pad.baseType', beat, waveStep / 3, 0));
    }

    out.push(paramEv('arp.decay', beat, 0.2 + (1 - e) * 0.6, 4));
    out.push(paramEv('arp.chorusWet', beat, 0.15 + v * 0.55, 6));
    if (bar % 12 === 0) {
      out.push(paramEv('arp.wave', beat, int(stream(seed, 'aw', bar), 0, 3) / 3, 0));
    }

    out.push(paramEv('bass.ampDecay', beat, 0.25 + e * 0.45, 4));
    out.push(paramEv('bass.drive', beat, 0.1 + e * 0.55 + 0.08 * drift(bar, 11, 1.1), 6));
    out.push(paramEv('bass.glide', beat, v * 0.35, 8));

    out.push(paramEv('lead.attack', beat, 0.15 + (1 - e) * 0.55, 6));
    out.push(paramEv('lead.release', beat, 0.35 + v * 0.5, 8));
    out.push(paramEv('lead.vibratoAmount', beat, e * 0.4 + v * 0.35, 8));
    out.push(paramEv('lead.chorusWet', beat, 0.2 + v * 0.4, 6));
    if (bar % 10 === 0) {
      out.push(paramEv('lead.wave0', beat, int(stream(seed, 'lw', bar), 0, 3) / 3, 0));
    }

    out.push(paramEv('pad.lfoRate', beat, 0.2 + v * 0.5, 8));
    out.push(paramEv('pad.lfoDepthCents', beat, 0.15 + e * 0.55, 8));
  }

  return out;
}
