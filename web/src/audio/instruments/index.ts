import type { LayerId, MoodId } from '@shared/index';
import { ArpInstrument } from './arp';
import { BassInstrument } from './bass';
import { DrumsInstrument } from './drums';
import type { Instrument } from './instrument';
import { LeadInstrument } from './lead';
import { PadInstrument } from './pad';
import { TextureInstrument } from './texture';

export type { Instrument, InstrumentParam } from './instrument';
export { PadInstrument, ArpInstrument, BassInstrument, LeadInstrument, DrumsInstrument, TextureInstrument };

export interface InstrumentSet {
  pad: PadInstrument;
  arp: ArpInstrument;
  bass: BassInstrument;
  lead: LeadInstrument;
  drums: DrumsInstrument;
  texture: TextureInstrument;
}

export function createInstruments(mood: MoodId): InstrumentSet {
  return {
    pad: new PadInstrument(mood),
    arp: new ArpInstrument(mood),
    bass: new BassInstrument(mood),
    lead: new LeadInstrument(mood),
    drums: new DrumsInstrument(mood),
    texture: new TextureInstrument(mood),
  };
}

export const LAYER_ORDER: readonly LayerId[] = ['pad', 'arp', 'bass', 'lead', 'drums', 'texture'];
export function allInstruments(set: InstrumentSet): Instrument[] {
  return LAYER_ORDER.map((l) => set[l]);
}
