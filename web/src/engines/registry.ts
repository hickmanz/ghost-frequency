import type { ComposerEngine } from './types';
import { AuteurEngine } from './auteurEngine';
import { DevelopEngine } from './developEngine';
import { LocalEngine } from './localEngine';
import { SparseAmbientEngine } from './sparseAmbientEngine';

export const DEFAULT_BROWSER_ENGINE_ID = 'js-auteur';

export interface BrowserEngineEntry {
  id: string;
  name: string;
  /** Short blurb for README / tooltips */
  description: string;
  factory: () => ComposerEngine;
}

export const BROWSER_ENGINES: readonly BrowserEngineEntry[] = [
  {
    id: 'js-auteur',
    name: 'Auteur (default)',
    description:
      'Full composition (sections, motifs, voice leading, all layers) plus timbral direction: the engine drives Sound Lab parameters over time: waves, ADSR, chorus, drive, filters, and space.',
    factory: () => new AuteurEngine(),
  },
  {
    id: 'local-js',
    name: 'Full (static timbre)',
    description:
      'The same composition as Auteur, but sounds stay where the mood presets and Sound Lab put them.',
    factory: () => new LocalEngine(),
  },
  {
    id: 'js-sparse',
    name: 'Sparse ambient',
    description:
      'Minimal alternate: slow chord loops, long pads, soft bass, very light arp. Good for drones and space.',
    factory: () => new SparseAmbientEngine(),
  },
  {
    id: 'js-develop',
    name: 'Developed',
    description:
      'Same harmony family as Full, but later passes of a section are arranged: motif in the arp, thinner call slots, and a sparse bell.',
    factory: () => new DevelopEngine(),
  },
];

export function listBrowserEngines(): { id: string; name: string }[] {
  return BROWSER_ENGINES.map(({ id, name }) => ({ id, name }));
}

export function browserEngineDescription(id: string): string | undefined {
  return BROWSER_ENGINES.find((e) => e.id === id)?.description;
}

export function normalizeBrowserEngineId(id: string): string {
  return BROWSER_ENGINES.some((e) => e.id === id) ? id : DEFAULT_BROWSER_ENGINE_ID;
}

export function createBrowserEngine(id: string): ComposerEngine {
  const entry = BROWSER_ENGINES.find((e) => e.id === id) ?? BROWSER_ENGINES[0]!;
  return entry.factory();
}
