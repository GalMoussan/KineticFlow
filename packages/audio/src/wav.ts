/** 16-bit PCM WAV encoder. Browser-safe. */

/**
 * Encodes interleaved float samples (−1..1) as a 16-bit little-endian PCM WAV.
 * `interleaved.length` must be `frames · channels`; values are scaled by 32767, rounded and clipped.
 */
export function encodeWav(interleaved: Float64Array | Float32Array, sampleRate: number, channels = 2): Uint8Array {
  if (interleaved.length % channels !== 0) throw new Error(`sample count ${interleaved.length} is not a multiple of ${channels} channels`);
  const dataBytes = interleaved.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0, o = 44; i < interleaved.length; i++, o += 2) {
    const v = Math.round(interleaved[i]! * 32767);
    view.setInt16(o, v > 32767 ? 32767 : v < -32768 ? -32768 : v, true);
  }
  return out;
}
