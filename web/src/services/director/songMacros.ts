/** Re-roll unpinned steer/tone/vibe/macro homes at each song boundary (Radio/Lab director). */

import { DEFAULT_VIBE, MOOD_IDS, type SteerParams, type ToneParams } from '@shared/index';

import { chance, stream } from '../../composition/rng';

import { clamp01 } from '../../composition/theory';

import { useStore } from '../store';

import { pinSet } from './effective';

import { blendSongHome, sampleSongHomes } from './songHomes';



export function rerollSongHomes(songIndex: number): void {

  const st = useStore.getState();

  const contrast = clamp01(st.params.contrast ?? 0.5);

  const rng = stream(st.params.seed, 'director-home', songIndex);

  const pins = pinSet(st.pins);

  const targets = sampleSongHomes(rng, contrast);



  if (st.chaos.stationDrift && !pins.has('mood') && chance(rng, 0.33)) {

    const moods = MOOD_IDS;

    const i = moods.indexOf(st.params.mood);

    const step = chance(rng, 0.5) ? 1 : -1;

    const j = (i + step + moods.length) % moods.length;

    st.setParams({ mood: moods[j]! });

  }



  const steer: SteerParams = { ...st.steer };

  for (const k of Object.keys(steer) as (keyof SteerParams)[]) {

    if (pins.has(k)) continue;

    steer[k] = blendSongHome(steer[k], targets.steer[k], contrast);

  }

  st.setSteer(steer);



  const tone: ToneParams = { ...st.tone };

  for (const k of Object.keys(tone) as (keyof ToneParams)[]) {

    if (pins.has(k)) continue;

    tone[k] = blendSongHome(tone[k], targets.tone[k], contrast);

  }

  st.setTone(tone);



  const vibe = { ...DEFAULT_VIBE, ...st.params.vibe };

  let vibeChanged = false;

  for (const k of ['brightness', 'tension', 'density', 'groove'] as const) {

    vibe[k] = blendSongHome(vibe[k], targets.vibe[k], contrast);

    vibeChanged = true;

  }



  const patch: Partial<typeof st.params> = {};

  if (vibeChanged) patch.vibe = vibe;

  for (const k of ['energy', 'complexity', 'variation'] as const) {

    if (pins.has(k)) continue;

    patch[k] = blendSongHome(st.params[k], targets[k], contrast);

  }

  if (Object.keys(patch).length) st.setParams(patch);

}


