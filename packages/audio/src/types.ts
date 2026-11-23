/** Shared audio types. Every buffer is Float32 per channel at 48 kHz unless a `sampleRate` says otherwise. */

export interface Stereo {
  l: Float32Array;
  r: Float32Array;
  sampleRate: number;
}

/** Decoded one-shots by manifest id. The Node loader lives in `@reel/render`; tests build one from `assets/samples/`. */
export interface SampleBank {
  get(id: string): Stereo | undefined;
}

export interface SampleEntry {
  id: string;
  /** Raw file URL pinned to a commit. */
  url: string;
  /** SHA-256 of the downloaded file bytes. */
  sha256: string;
  license: 'CC0-1.0';
  /** Pack and path the file comes from. */
  source: string;
  /** Gain the engine applies when it loads the sample (peak-normalises the kit). */
  gainDb?: number;
  /** Seconds of the source to keep: `start` drops leading silence, `end` cuts long tails (10 ms fade). */
  trim?: { start?: number; end?: number };
}

export const SAMPLE_RATE = 48000;

/** Silent stereo buffer of `frames` frames. */
export function silence(frames: number, sampleRate = SAMPLE_RATE): Stereo {
  return { l: new Float32Array(frames), r: new Float32Array(frames), sampleRate };
}
