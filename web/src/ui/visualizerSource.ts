/**
 * Injection point so the UI can draw audio-reactive visuals without importing the audio layer.
 * The Conductor/renderer registers a source with setVisualizerSource().
 */
export interface VisualizerSource {
  /** Spectrum in dB (typically -100..-30), low frequency first, covering 0..Nyquist. Should not allocate per call. */
  getSpectrum(): Float32Array;
  /** Overall output level, linear 0..1. */
  getLevel(): number;
}

let source: VisualizerSource | null = null;

export function setVisualizerSource(src: VisualizerSource | null): void {
  source = src;
}

export function getVisualizerSource(): VisualizerSource | null {
  return source;
}
