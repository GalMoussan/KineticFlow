/** Score → WAV (`@reel/audio`) → two-pass loudnorm → AAC 256k of exactly frames/fps seconds (PLAN.md §8.2). */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMusic } from '@reel/audio';
import type { CueSheet, JobSpec } from '@reel/core';
import { ffmpeg, sha256 } from './util.ts';

export const SAMPLE_RATE = 48_000;
export const TARGET_LUFS = -14;
/** Delivered ceiling is −1 dBTP; loudnorm aims 0.5 dB lower because AAC adds inter-sample overshoot (measured +0.06). */
export const TARGET_TP = -1;
const LOUDNORM_TP = TARGET_TP - 0.5;

export interface Loudness {
  /** Integrated loudness, LUFS. */
  i: number;
  /** True peak, dBTP. */
  tp: number;
  lra: number;
  thresh: number;
  offset: number;
}

export interface AudioResult {
  /** Source score (16-bit PCM). Absent for `music.source = none`. */
  wav?: { path: string; sha256: string; samples: number; sampleRate: number; notes: number; peak: number };
  /** AAC 256k in MP4, normalised. */
  aac: string;
  /** Samples of the encoded stream before AAC framing: round(frames/fps · sr). */
  samples: number;
  sampleRate: number;
  /** Measured on the encoded AAC (absent for silence). */
  loudness?: Loudness;
  /** `linear` when loudnorm could reach the target without its dynamic mode. */
  normalization?: string;
  ms: number;
}

/** Last JSON object loudnorm prints to stderr. */
function loudnormJson(stderr: string): Record<string, string> {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`loudnorm printed no measurement:\n${stderr.slice(-400)}`);
  return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
}

const LN = `loudnorm=I=${TARGET_LUFS}:TP=${LOUDNORM_TP}:LRA=11`;

/** First loudnorm pass on any audio file: the EBU R128 measurement. */
export async function measureLoudness(path: string): Promise<Loudness> {
  const { stderr } = await ffmpeg(['-i', path, '-af', `${LN}:print_format=json`, '-f', 'null', '-']);
  const m = loudnormJson(stderr);
  return {
    i: Number(m.input_i),
    tp: Number(m.input_tp),
    lra: Number(m.input_lra),
    thresh: Number(m.input_thresh),
    offset: Number(m.target_offset),
  };
}

export async function renderAudio(o: { spec: JobSpec; sheet: CueSheet; workDir: string }): Promise<AudioResult> {
  const t0 = performance.now();
  const sr = SAMPLE_RATE;
  const samples = Math.round((o.sheet.frames / o.sheet.fps) * sr);
  const aac = join(o.workDir, 'audio.m4a');
  // exact length: pad/trim to `samples` after resampling loudnorm's 192 kHz output back to 48 kHz
  const fit = `aresample=${sr},apad=whole_len=${samples},atrim=end_sample=${samples}`;
  const enc = ['-c:a', 'aac', '-b:a', '256k', '-ar', String(sr), '-ac', '2', '-movflags', '+faststart', aac];

  const music = o.spec.music;
  if (music.source === 'none') {
    await ffmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=stereo`, '-af', fit, ...enc]);
    return { aac, samples, sampleRate: sr, ms: performance.now() - t0 };
  }
  if (music.source !== 'preset') throw new Error(`music source "${music.source}" arrives in M3`);

  const r = renderMusic(o.sheet, { preset: music.preset, bpm: music.bpm, seed: music.seed }, sr);
  const wavPath = join(o.workDir, 'score.wav');
  await writeFile(wavPath, r.wav);

  const m = await measureLoudness(wavPath);
  const pass2 =
    `${LN}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}` +
    `:offset=${m.offset}:linear=true:print_format=json`;
  const { stderr } = await ffmpeg(['-y', '-i', wavPath, '-af', `${pass2},${fit}`, ...enc]);
  const normalization = loudnormJson(stderr).normalization_type;
  return {
    wav: { path: wavPath, sha256: sha256(r.wav), samples: r.samples, sampleRate: r.sampleRate, notes: r.notes, peak: r.peak },
    aac,
    samples,
    sampleRate: sr,
    loudness: await measureLoudness(aac),
    ...(normalization ? { normalization } : {}),
    ms: performance.now() - t0,
  };
}
