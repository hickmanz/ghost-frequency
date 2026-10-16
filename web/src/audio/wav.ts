/** Pure WAV encoder (no Tone dependency). 16-bit PCM, interleaved, any channel count. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numCh = channels.length;
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const dataSize = length * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i] ?? 0));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV Blob. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  return new Blob([encodeWav(chans, buffer.sampleRate)], { type: 'audio/wav' });
}
