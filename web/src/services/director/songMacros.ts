/** Re-roll unpinned steer/tone/macro homes at each song boundary (Radio/Lab director). */
import { DEFAULT_STEER, DEFAULT_TONE, MOOD_IDS, type SteerParams, type ToneParams } from '@shared/index';
import { chance, stream } from '../../composition/rng';
import { clamp01 } from '../../composition/theory';
import { useStore } from '../store';
import { pinSet } from './effective';

export function rerollSongHomes(songIndex: number): void {
  const st = useStore.getState();
  const rng = stream(st.params.seed, 'director-home', songIndex);
  const span = 0.12 + (st.params.contrast ?? 0.5) * 0.38;
  const pins = pinSet(st.pins);

  if (st.chaos.stationDrift && !pins.has('mood') && chance(rng, 0.33)) {
    const moods = MOOD_IDS;
    const i = moods.indexOf(st.params.mood);
    const step = chance(rng, 0.5) ? 1 : -1;
    const j = (i + step + moods.length) % moods.length;
    st.setParams({ mood: moods[j]! });
  }

  const steer: SteerParams = { ...st.steer };
  for (const k of Object.keys(DEFAULT_STEER) as (keyof SteerParams)[]) {
    if (pins.has(k)) continue;
    steer[k] = clamp01(steer[k] + (rng.next() * 2 - 1) * span);
  }
  st.setSteer(steer);

  const tone: ToneParams = { ...st.tone };
  for (const k of Object.keys(DEFAULT_TONE) as (keyof ToneParams)[]) {
    if (pins.has(k)) continue;
    tone[k] = clamp01(tone[k] + (rng.next() * 2 - 1) * span * 0.85);
  }
  st.setTone(tone);

  const patch: Partial<typeof st.params> = {};
  for (const k of ['complexity', 'variation'] as const) {
    if (pins.has(k)) continue;
    patch[k] = clamp01(st.params[k] + (rng.next() * 2 - 1) * span * 0.7);
  }
  if (Object.keys(patch).length) st.setParams(patch);
}
