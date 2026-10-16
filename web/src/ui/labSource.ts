import type { LayerId } from '@shared/index';

/**
 * Injected data source for the Sound Lab live visuals (keeps ui/ free of audio imports).
 * Registered in main.tsx from the AudioRenderer.
 */
export interface LabSource {
  setMonitorLayer(layer: LayerId | null): void;
  getMonitorWaveform(): Float32Array;
  getMonitorSpectrum(): Float32Array;
  getLayerLevels(): Record<LayerId, number>;
  /** sample rate of the audio context (for frequency axes); default 44100 if unknown */
  getSampleRate(): number;
}

let source: LabSource | null = null;

export function setLabSource(s: LabSource | null): void {
  source = s;
}

export function getLabSource(): LabSource | null {
  return source;
}
