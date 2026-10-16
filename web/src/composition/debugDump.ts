/**
 * Human-inspection helper: prints a text piano-roll-ish summary of N bars.
 *
 *   npx vite-node web/src/composition/debugDump.ts -- [seed] [mood] [bars] [energy] [complexity] [variation]
 *
 * Also importable: dumpBars({...}) returns the text.
 */
import { DEFAULT_PARAMS, DRUM, type GenerationParams, type MoodId, type NoteEvent } from '@shared/index';
import { LocalEngine } from '../engines/localEngine';
import { keyLabel, midiName } from './theory';

export interface DumpOptions {
  seed?: number;
  mood?: MoodId;
  bars?: number;
  energy?: number;
  complexity?: number;
  variation?: number;
  fromBar?: number;
}

function drumGrid(notes: NoteEvent[], barStart: number): string {
  const cells: string[] = new Array(16).fill('.');
  const put = (step: number, ch: string, rank: number): void => {
    const rankOf = (c: string): number => ('.'.includes(c) ? 0 : 'hH'.includes(c) ? 1 : 'ck'.includes(c) ? 2 : 3);
    if (rankOf(ch) >= rankOf(cells[step]!) || rank > 0) cells[step] = ch;
  };
  for (const n of notes) {
    const step = Math.round((n.beat - barStart) * 4);
    if (step < 0 || step > 15) continue;
    if (n.midi === DRUM.kick) put(step, 'K', 3);
    else if (n.midi === DRUM.snare) put(step, 'S', 3);
    else if (n.midi === DRUM.clap) put(step, cells[step] === 'S' ? 'S' : 'C', 2);
    else if (n.midi === DRUM.hatClosed) put(step, n.vel < 0.18 ? 'h' : 'H', 0);
    else if (n.midi === DRUM.hatOpen) put(step, 'O', 1);
    else if (n.midi === DRUM.crash) put(step, '*', 3);
    else if (n.midi === DRUM.tom) put(step, 'T', 3);
  }
  return cells.join('');
}

export function dumpBars(opts: DumpOptions = {}): string {
  const params: GenerationParams = {
    ...DEFAULT_PARAMS,
    seed: opts.seed ?? DEFAULT_PARAMS.seed,
    mood: opts.mood ?? DEFAULT_PARAMS.mood,
    energy: opts.energy ?? DEFAULT_PARAMS.energy,
    complexity: opts.complexity ?? DEFAULT_PARAMS.complexity,
    variation: opts.variation ?? DEFAULT_PARAMS.variation,
  };
  const bars = opts.bars ?? 32;
  const from = opts.fromBar ?? 0;
  const eng = new LocalEngine();
  eng.init(params.seed, params);
  // render in 4-bar batches like a conductor would
  const lines: string[] = [];
  lines.push(`seed=${params.seed} mood=${params.mood} energy=${params.energy} cx=${params.complexity} var=${params.variation}`);
  for (let b = 0; b < from + bars; b += 4) {
    const batch = eng.renderBars(b, 4, params);
    if (b === 0) lines.push(`tempo=${batch.tempo} BPM`);
    for (let bar = b; bar < b + 4; bar++) {
      if (bar < from) continue;
      const s = bar * 4;
      const inBar = batch.events.filter((e) => e.beat >= s && e.beat < s + 4);
      const notes = inBar.filter((e): e is NoteEvent => e.kind === 'note');
      const layer = (l: string): NoteEvent[] => notes.filter((n) => n.layer === l);
      const sec = inBar.find((e) => e.kind === 'section');
      if (sec && sec.kind === 'section') {
        lines.push(
          `--- bar ${bar}  ${sec.name}#${sec.sectionIndex}  ${keyLabel(sec.key)}  chord ${sec.chord?.label ?? '?'} (${sec.chord?.numeral ?? ''})  energy ${sec.energy.toFixed(2)}`,
        );
      }
      const fmt = (arr: NoteEvent[]): string =>
        arr.map((n) => `${midiName(n.midi)}@${(n.beat - s).toFixed(2).replace(/\.00$/, '')}${n.durBeats > 4.5 ? `(${(n.durBeats / 4).toFixed(1)}b)` : ''}`).join(' ');
      lines.push(`bar ${String(bar).padStart(3)} pad   ${fmt(layer('pad'))}`);
      const bass = layer('bass');
      if (bass.length) lines.push(`        bass  ${fmt(bass)}`);
      const arp = layer('arp');
      if (arp.length) lines.push(`        arp   ${arp.length}n: ${arp.map((n) => midiName(n.midi)).join(' ')}`);
      const lead = layer('lead');
      if (lead.length) lines.push(`        lead  ${fmt(lead)}`);
      const drums = layer('drums');
      if (drums.length) lines.push(`        drums ${drumGrid(drums, s)}`);
      const tex = layer('texture');
      if (tex.length) lines.push(`        tex   ${fmt(tex)}`);
      const auto = inBar.filter((e) => e.kind === 'automation');
      const gains = auto.filter((e) => e.kind === 'automation' && e.target.startsWith('layer.gain') ).map((e) => (e.kind === 'automation' ? `${e.target.slice(11)}->${e.value}/${e.rampBeats ?? 0}` : ''));
      const misc = auto.filter((e) => e.kind === 'automation' && (e.target === 'master.filter')).map((e) => (e.kind === 'automation' ? `master.filter->${e.value.toFixed(2)}/${e.rampBeats ?? 0}` : ''));
      if (gains.length || misc.length) lines.push(`        auto  ${[...gains, ...misc].join(' ')}`);
    }
  }
  return lines.join('\n');
}

const g = globalThis as unknown as { process?: { argv?: string[] } };
const argv = g.process?.argv ?? [];
const runner = argv.findIndex((a) => a.endsWith('vite-node.mjs'));
if (runner >= 0) {
  const rest = argv.slice(runner + 1).filter((a) => a !== '--' && !a.endsWith('debugDump.ts'));
  const [seed, mood, bars, energy, cx, vr] = rest;
  console.log(
    dumpBars({
      seed: seed ? Number(seed) : undefined,
      mood: mood as MoodId | undefined,
      bars: bars ? Number(bars) : undefined,
      energy: energy ? Number(energy) : undefined,
      complexity: cx ? Number(cx) : undefined,
      variation: vr ? Number(vr) : undefined,
    }),
  );
}
