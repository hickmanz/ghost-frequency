import * as Tone from 'tone';

/** Names of the optional drum one-shots expected in web/public/assets/drums/<name>.wav */
export const DRUM_SAMPLE_NAMES = ['kick', 'snare', 'clap', 'hat', 'openhat'] as const;
export type DrumSampleName = (typeof DRUM_SAMPLE_NAMES)[number];
export type DrumSampleSet = Partial<Record<DrumSampleName, AudioBuffer>>;

function baseUrl(): string {
  // import.meta.env is injected by Vite (and Vitest); guard so this also works in plain tooling.
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const b = env?.BASE_URL ?? './';
  return b.endsWith('/') ? b : b + '/';
}

export function drumSampleUrl(name: DrumSampleName, ext = 'wav'): string {
  return `${baseUrl()}assets/drums/${name}.${ext}`;
}

async function loadOne(name: DrumSampleName): Promise<AudioBuffer | undefined> {
  try {
    // only .wav is probed (one request per file) to keep the console quiet when samples are absent
    for (const ext of ['wav']) {
      const res = await fetch(drumSampleUrl(name, ext));
      if (!res.ok) continue;
      // Vite's dev server answers unknown paths with index.html (200) -> reject non-audio responses
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/html')) continue;
      const data = await res.arrayBuffer();
      if (data.byteLength < 64) continue;
      try {
        return await Tone.getContext().decodeAudioData(data);
      } catch {
        // undecodable file -> try next extension / fall back to synth
      }
    }
  } catch {
    // network error / file missing -> synth fallback
  }
  return undefined;
}

let cache: Promise<DrumSampleSet> | null = null;

/**
 * Tries to load the optional drum samples. NEVER rejects; missing/broken files are simply absent from the result
 * (the drum instrument then uses its synthesized fallback for that voice). Result is cached.
 */
export function loadDrumSamples(): Promise<DrumSampleSet> {
  if (!cache) {
    cache = Promise.all(DRUM_SAMPLE_NAMES.map(async (n) => [n, await loadOne(n)] as const))
      .then((entries) => {
        const set: DrumSampleSet = {};
        for (const [n, b] of entries) if (b) set[n] = b;
        return set;
      })
      .catch(() => ({}) as DrumSampleSet);
  }
  return cache;
}
