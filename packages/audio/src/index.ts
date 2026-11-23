/** Music for reels (PLAN.md §8.2): presets turn a cue sheet into notes; the synth renders them to a WAV. */
import type { CueSheet } from '@reel/core';
import { limit } from './limiter.ts';
import { lofiJazz, type PresetMusic } from './presets/lofi-jazz.ts';
import { synthesize, type ScoreDocument } from './synth.ts';
import { encodeWav } from './wav.ts';

/**
 * Master-bus limiting: −4.4 dB on the transient peaks (kicks) brings true peak − integrated loudness to ≈ 10.6 dB
 * on the example, so ffmpeg `loudnorm` can reach −14 LUFS / −1.5 dBTP in linear mode (needs ≤ ~12.5 dB).
 */
const BUS_LIMIT = { ceiling: 0.6, lookahead: 0.005, release: 0.15 };
/** Final sample peak of every render. */
const PEAK = 0.95;

export { synthesize, mulberry32, ScoreError, WAVEFORMS } from './synth.ts';
export { limit } from './limiter.ts';
export type { LimitOptions } from './limiter.ts';
export type { NoteEvent, ScoreDocument, SynthResult, Waveform } from './synth.ts';
export { encodeWav } from './wav.ts';
export { lofiJazz } from './presets/lofi-jazz.ts';
export type { PresetMusic } from './presets/lofi-jazz.ts';

export interface MusicResult {
  /** 16-bit stereo PCM WAV. */
  wav: Uint8Array;
  sampleRate: number;
  /** Frames per channel: `round(duration · sampleRate)`. */
  samples: number;
  /** Note events rendered. */
  notes: number;
  /** Peak |sample| after normalisation (≤ 0.95). */
  peak: number;
}

const PRESETS: Record<string, (sheet: CueSheet, music: PresetMusic, sampleRate?: number) => ScoreDocument> = {
  'lofi-jazz': lofiJazz,
};

export const MUSIC_PRESETS: string[] = Object.keys(PRESETS);

/** The note document a preset writes for this cue sheet (what `renderMusic` synthesises). */
export function musicScore(sheet: CueSheet, music: { preset: string; bpm: number; seed: number }, sampleRate = 48000): ScoreDocument {
  const preset = PRESETS[music.preset];
  if (!preset) throw new Error(`unknown music preset "${music.preset}" (known: ${MUSIC_PRESETS.join(', ')})`);
  return preset(sheet, music, sampleRate);
}

/** Synthesises the preset's score, limits the bus and normalises the peak to 0.95. Deterministic. */
export function renderMusic(sheet: CueSheet, music: { preset: string; bpm: number; seed: number }, sampleRate = 48000): MusicResult {
  const doc = musicScore(sheet, music, sampleRate);
  const { mix, samples } = synthesize(doc);
  limit(mix, sampleRate, BUS_LIMIT);
  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]!));
  const k = PEAK / Math.max(peak, 1e-12);
  let out = 0;
  for (let i = 0; i < mix.length; i++) out = Math.max(out, Math.abs((mix[i]! *= k)));
  return { wav: encodeWav(mix, sampleRate, 2), sampleRate, samples, notes: doc.notes.length, peak: out };
}
