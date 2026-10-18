import * as Tone from 'tone';
import { isIOSLike } from '../services/staticHost';

/** Minimal silent WAV (44 bytes) — activates the media audio route on iOS Safari. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let iosUnlockEl: HTMLAudioElement | null = null;

declare global {
  interface Navigator {
    audioSession?: { type: string; state?: string };
  }
}

/** Prefer the media/playback route (speaker/headphones) instead of ambient on iOS 17+. */
export function configureAudioSession(): void {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    /* optional API */
  }
}

/**
 * iOS often routes Web Audio to a silent path until a media element has played once in the same gesture.
 * Call from the user tap handler (with primeAudioUnlock).
 */
export function iosMediaChannelUnlock(): void {
  if (!isIOSLike() || typeof document === 'undefined') return;
  configureAudioSession();
  try {
    if (!iosUnlockEl) {
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', 'true');
      el.preload = 'auto';
      el.src = SILENT_WAV;
      el.volume = 0.01;
      el.style.display = 'none';
      document.body.appendChild(el);
      iosUnlockEl = el;
    }
    iosUnlockEl.currentTime = 0;
    void iosUnlockEl.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/**
 * Call synchronously at the start of a tap/click handler (before awaits) so iOS Safari keeps the user-gesture
 * entitlement for AudioContext.resume().
 */
export function primeAudioUnlock(): void {
  configureAudioSession();
  iosMediaChannelUnlock();
  void Tone.start().catch(() => undefined);
  const ctx = Tone.getContext().rawContext;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** After graph setup, ensure the context is running (iOS can stay suspended until resume). */
export async function ensureAudioRunning(): Promise<void> {
  configureAudioSession();
  await Tone.start();
  const ctx = Tone.getContext().rawContext;
  if (ctx.state !== 'running') await ctx.resume();
  iosMediaChannelUnlock();
}

/** iOS: interactive context + extra lookahead so Transport callbacks are not missed on a busy main thread. */
export function configureMobileContext(): void {
  if (!isIOSLike()) return;
  try {
    Tone.setContext(
      new Tone.Context({
        latencyHint: 'interactive',
        lookAhead: 0.35,
      }),
      true,
    );
  } catch {
    /* keep default */
  }
}

export function usePlaybackLatencyContext(): boolean {
  return !isIOSLike();
}
