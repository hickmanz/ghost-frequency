/**
 * Map normalized composer automation (0..1) onto Sound Lab parameter ranges.
 * Only keys listed here may be driven by `param.<layer>.<field>` automation events.
 */
import type { LayerId } from '@shared/index';
import { TUNING_SCHEMA } from './params';
import type { TuningParam } from './schema';

const metaByKey = new Map<string, TuningParam>();
for (const g of TUNING_SCHEMA) {
  for (const p of g.params) metaByKey.set(p.key, p);
}

export function isAutomatableParamKey(key: string): boolean {
  return metaByKey.has(key);
}

export function getParamMeta(key: string): TuningParam | undefined {
  return metaByKey.get(key);
}

/** 0..1 -> parameter value in native units (clamped to schema min/max). */
export function paramValueFrom01(key: string, value01: number): number | null {
  const meta = metaByKey.get(key);
  if (!meta) return null;
  const t = Math.max(0, Math.min(1, value01));
  if (meta.kind === 'choice' && meta.options?.length) {
    const idx = Math.min(meta.options.length - 1, Math.floor(t * meta.options.length));
    return meta.options[idx]!.value;
  }
  if (meta.scale === 'log') {
    const lo = Math.log(meta.min);
    const hi = Math.log(meta.max);
    return Math.exp(lo + (hi - lo) * t);
  }
  return meta.min + (meta.max - meta.min) * t;
}

export function layerFromParamKey(key: string): LayerId | null {
  const layer = key.split('.')[0];
  const layers: LayerId[] = ['pad', 'arp', 'bass', 'lead', 'drums', 'texture', 'bell'];
  return layers.includes(layer as LayerId) ? (layer as LayerId) : null;
}

/** Keys the Auteur engine may drive (subset of Sound Lab — live-ramp safe). */
export const AUTEUR_PARAM_KEYS = [
  'pad.baseType',
  'pad.attack',
  'pad.release',
  'pad.chorusWet',
  'pad.spread',
  'pad.lfoRate',
  'pad.lfoDepthCents',
  'arp.wave',
  'arp.attack',
  'arp.decay',
  'arp.release',
  'arp.chorusWet',
  'bass.wave',
  'bass.ampDecay',
  'bass.drive',
  'bass.glide',
  'lead.wave0',
  'lead.attack',
  'lead.release',
  'lead.vibratoAmount',
  'lead.chorusWet',
] as const;
