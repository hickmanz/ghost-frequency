import { WAVES, type Wave } from '../presets';
import { paramValueFrom01 } from '../../tuning/paramAutomation';

export function waveFromChoiceValue(n: number): Wave {
  const i = Math.max(0, Math.min(WAVES.length - 1, Math.round(n)));
  return WAVES[i]!;
}

export function denorm(key: string, value01: number): number | null {
  return paramValueFrom01(key, value01);
}
