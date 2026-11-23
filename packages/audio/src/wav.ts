/** WAV encode/decode. Browser-safe and deterministic. */
import { resample } from './resample.ts';
import { SAMPLE_RATE, type Stereo } from './types.ts';

/** Encodes stereo float samples (−1..1) as a 16- or 24-bit little-endian PCM WAV (rounded, clipped, no dither). */
export function encodeWav(x: Stereo, bits: 16 | 24 = 16): Uint8Array {
  const frames = x.l.length;
  if (x.r.length !== frames) throw new Error(`channel lengths differ: ${frames} vs ${x.r.length}`);
  const bytes = bits / 8;
  const block = 2 * bytes;
  const dataBytes = frames * block;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true);
  view.setUint32(24, x.sampleRate, true);
  view.setUint32(28, x.sampleRate * block, true);
  view.setUint16(32, block, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  const full = bits === 16 ? 32767 : 8388607;
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of [x.l, x.r]) {
      let v = Math.round(ch[i]! * full);
      v = v > full ? full : v < -full - 1 ? -full - 1 : v;
      if (bits === 16) view.setInt16(o, v, true);
      else {
        out[o] = v & 0xff;
        out[o + 1] = (v >> 8) & 0xff;
        out[o + 2] = (v >> 16) & 0xff;
      }
      o += bytes;
    }
  }
  return out;
}

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

/**
 * Decodes a RIFF/WAVE file: integer PCM 8/16/24/32, float 32/64, and WAVE_FORMAT_EXTENSIBLE with either subformat.
 * Mono becomes dual-mono; channels beyond two are dropped. Resamples to 48 kHz with the deterministic resampler.
 */
export function decodeWav(bytes: Uint8Array): Stereo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: [number, number] | null = null;
  for (let o = 12; o + 8 <= bytes.byteLength; ) {
    const id = tag(o);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === EXTENSIBLE) {
        if (size < 40) throw new Error('WAVE_FORMAT_EXTENSIBLE fmt chunk is too short');
        format = view.getUint16(body + 24, true); // first two bytes of the subformat GUID
      }
    } else if (id === 'data') {
      data = [body, Math.min(size, bytes.byteLength - body)];
      if (format) break;
    }
    o = body + size + (size & 1);
  }
  if (!format) throw new Error('WAV has no fmt chunk');
  if (!data) throw new Error('WAV has no data chunk');
  if (!channels || !rate) throw new Error('WAV fmt chunk declares no channels or no sample rate');
  const width = bits / 8;
  const ok = (format === PCM && [8, 16, 24, 32].includes(bits)) || (format === FLOAT && (bits === 32 || bits === 64));
  if (!ok) throw new Error(`unsupported WAV encoding: format ${format}, ${bits} bits`);
  const frame = width * channels;
  const frames = Math.floor(data[1] / frame);
  const read = (o: number): number => {
    if (format === FLOAT) return bits === 32 ? view.getFloat32(o, true) : view.getFloat64(o, true);
    switch (bits) {
      case 8:
        return (bytes[o]! - 128) / 128;
      case 16:
        return view.getInt16(o, true) / 32768;
      case 24:
        return ((bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16)) << 8 >> 8) / 8388608;
      default:
        return view.getInt32(o, true) / 2147483648;
    }
  };
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  const right = channels > 1 ? width : 0;
  for (let i = 0, o = data[0]; i < frames; i++, o += frame) {
    l[i] = read(o);
    r[i] = read(o + right);
  }
  if (rate === SAMPLE_RATE) return { l, r, sampleRate: SAMPLE_RATE };
  const rl = resample(l, rate, SAMPLE_RATE);
  return { l: rl, r: channels > 1 ? resample(r, rate, SAMPLE_RATE) : rl.slice(), sampleRate: SAMPLE_RATE };
}
