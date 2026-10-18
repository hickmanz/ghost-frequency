/** Cyber-leaning lofi title generator (deterministic from rng). */
import { chance, int, pick, stream, weightedPick, type Rng } from './rng';

const ADJ = [
  'neon', 'midnight', 'holographic', 'static', 'faded', 'quantum', 'lazy', 'violet', 'chrome', 'dusty',
  'parallel', 'soft', 'glitch', 'amber', 'lonely', 'satellite', 'retro', 'warm', 'hazy', 'digital',
];
const NOUN = [
  'highway', 'arcade', 'rain', 'cassette', 'skyline', 'modem', 'parking lot', 'elevator', 'mall', 'terminal',
  'balcony', 'train', 'vending machine', 'palm trees', 'synth', 'memory', 'frequency', 'ghost', 'waveform', 'city',
];
const SINGLE = ['drift', 'afterglow', 'reverie', 'solace', 'undertow', 'slumber', 'petrichor', 'sonder', 'vapor'];
const TAG = ['demo', 'loop', 'edit', 'reprise', 'sketch', 'v2', 'side b'];

const PATTERNS: ReadonlyArray<readonly [(r: Rng) => string, number]> = [
  [(r) => `${pick(r, ADJ)} ${pick(r, NOUN)}`, 5],
  [(r) => `${pick(r, NOUN)} at ${int(r, 2, 4)}am`, 3],
  [(r) => `${pick(r, SINGLE)}`, 2],
  [(r) => `${pick(r, ADJ)} ${pick(r, NOUN)} (${pick(r, TAG)})`, 2],
  [(r) => `${pick(r, NOUN)} pt. ${int(r, 2, 4)}`, 1],
];

export function songTitle(seed: number, songIndex: number): string {
  const rng = stream(seed, 'title', songIndex);
  const raw = weightedPick(rng, PATTERNS)(rng);
  return chance(rng, 0.15) ? raw.toUpperCase() : raw;
}
