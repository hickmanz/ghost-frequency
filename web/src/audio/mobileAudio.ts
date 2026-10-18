import * as Tone from 'tone';
import { isIOSLike } from '../services/staticHost';

/**
 * Call synchronously at the start of a tap/click handler (before awaits) so iOS Safari keeps the user-gesture
 * entitlement for AudioContext.resume().
 */
export function primeAudioUnlock(): void {
  void Tone.start().catch(() => undefined);
  const ctx = Tone.getContext().rawContext;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** After graph setup, ensure the context is running (iOS can stay suspended until resume). */
export async function ensureAudioRunning(): Promise<void> {
  await Tone.start();
  const ctx = Tone.getContext().rawContext;
  if (ctx.state !== 'running') await ctx.resume();
}

/** Custom Tone context is flaky on iOS; use the default interactive context there. */
export function usePlaybackLatencyContext(): boolean {
  return !isIOSLike();
}
