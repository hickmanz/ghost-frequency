import type { EventBatch, GenerationParams, MixerParams } from '@shared/index';
import { audioBufferToWav, renderOffline } from '../audio/offline';
import type { ComposerEngine } from './types';

/**
 * Render `bars` bars of a fresh composition (same seed/params as given) faster than real time
 * and trigger a WAV download. Uses a separate engine instance, so live playback state is untouched.
 */
export async function exportWav(
  engine: ComposerEngine,
  params: GenerationParams,
  mixer: MixerParams,
  bars: number,
): Promise<void> {
  engine.init(params.seed, params);
  const batches: EventBatch[] = [];
  for (let bar = 0; bar < bars; bar++) batches.push(engine.renderBars(bar, 1, params));
  const tempo = batches[0]?.tempo ?? params.tempo ?? 90;
  const buffer = await renderOffline(batches, bars, tempo, params.mood, mixer);
  const blob = audioBufferToWav(buffer);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghost-frequency_${params.mood}_${params.seed}_${bars}bars.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
