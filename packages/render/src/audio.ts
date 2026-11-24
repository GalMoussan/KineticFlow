/**
 * Audio (PLAN.md §8.2): music source → stem → grid → cue sheet with envelopes (`prepareMusic`), then
 * music + SFX → `mix` → `master` → WAV → two-pass loudnorm → AAC 256k of exactly frames/fps seconds (`finishAudio`).
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeEnvelopes, encodeWav, master, mix, renderMusic, type SampleBank, type Stereo } from '@reel/audio';
import type { Choreography, CueSheet, JobSpec } from '@reel/core';
import { buildCueSheet, MIN_METER_CONFIDENCE, trimEdgeBeats } from '@reel/timing';
import { analyzeTrack } from './analysis.ts';
import { beatStrengths, decodeTrack, resolveTrack, videoGrid } from './track.ts';
import { ffmpeg, sha256 } from './util.ts';

export const SAMPLE_RATE = 48_000;
export const TARGET_LUFS = -14;
/** Delivered ceiling is −1 dBTP; loudnorm aims 0.5 dB lower because AAC adds inter-sample overshoot (measured +0.06). */
export const TARGET_TP = -1;
const LOUDNORM_TP = TARGET_TP - 0.5;
/** Stem gains into the mix. SFX levels are designed against the presets in `@reel/audio` (QA gate `sfx` checks them). */
const MUSIC_GAIN = 1;
const SFX_GAIN = 1;
/** Sample-peak ceiling (−1.5 dBFS) of audio that skips loudnorm: keeps AAC under −1 dBTP. */
const UNNORMALISED_PEAK = 0.84;
/** `master` leaves the sample peak at 0.95; SFX without music come down to `UNNORMALISED_PEAK` (20·log10(0.84/0.95)). */
const UNNORMALISED_TRIM_DB = -1.07;

export interface Loudness {
  /** Integrated loudness, LUFS. */
  i: number;
  /** True peak, dBTP. */
  tp: number;
  lra: number;
  thresh: number;
  offset: number;
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

/** SHA-256 of a stem's float samples, left channel then right. */
export function stereoSha(x: Stereo): string {
  const h = createHash('sha256');
  for (const ch of [x.l, x.r]) h.update(new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength));
  return h.digest('hex');
}

// ───────────────────────────── steps 1–3: music source, grid, cue sheet ─────────────────────────────

export type MusicInfo =
  | { source: 'preset'; preset: string; bpm: number; seed: number; notes: number; ms: number }
  | {
      source: 'track';
      file: string;
      path: string;
      /** SHA-256 of the track file. */
      sha256: string;
      offset: number;
      fadeOut: number;
      /** Seconds of the video covered by the track (less than the duration when the file ends early). */
      covered: number;
      /** Median detected tempo. */
      bpm: number;
      /** Detected beats and downbeats inside the video (after phantom-beat trimming). */
      beats: number;
      downbeats: number;
      meter: number | null;
      meterConfidence: number | null;
      /** Whether the detected downbeats were trusted (meter confidence ≥ 0.8). */
      downbeatsUsed: boolean;
      /** Phantom beats dropped at the start/end of the window. */
      trimmed: { head: number; tail: number };
      analysis: { cached: boolean; model: string; path: string; ms: number };
      ms: number;
    }
  | { source: 'none'; bpm: number };

export interface MusicStage {
  /** The cue sheet, with `envelopes` of the music stem when there is one. */
  sheet: CueSheet;
  /** 48 kHz music stem, exactly round(frames/fps · 48000) samples; null for `music.source = none`. */
  music: Stereo | null;
  info: MusicInfo;
  /** Track jobs: every detected beat in video time, untrimmed (the `audio-sync` gate's reference). */
  detectedBeats?: number[];
}

/**
 * Render order steps 1–3: the music source (preset render, or track decode + trim + fade), the grid (track analysis)
 * → cue sheet, and the band envelopes of the music stem → `sheet.envelopes`.
 */
export async function prepareMusic(o: {
  spec: JobSpec;
  specDir: string;
  choreography: Choreography;
  fps: number;
  samples: SampleBank;
  /** Tempo of the visual grid without music (the style's default). */
  defaultBpm?: number;
}): Promise<MusicStage> {
  const start = performance.now();
  const { spec, fps, choreography } = o;
  const frames = Math.round(spec.duration * fps);
  const m = spec.music;
  switch (m.source) {
    case 'none': {
      const bpm = o.defaultBpm ?? 100;
      return { sheet: buildCueSheet({ spec, choreography, bpm, fps }), music: null, info: { source: 'none', bpm } };
    }
    case 'preset': {
      const sheet = buildCueSheet({ spec, choreography, bpm: m.bpm, fps });
      const r = renderMusic(sheet, { preset: m.preset, bpm: m.bpm, seed: m.seed }, { samples: o.samples, sampleRate: SAMPLE_RATE });
      const music: Stereo = { l: r.l, r: r.r, sampleRate: r.sampleRate };
      return {
        sheet: { ...sheet, envelopes: computeEnvelopes(music, fps, frames) },
        music,
        info: { source: 'preset', preset: m.preset, bpm: m.bpm, seed: m.seed, notes: r.notes, ms: performance.now() - start },
      };
    }
    case 'track': {
      const path = await resolveTrack(o.specDir, m.file);
      const samples = Math.round((frames / fps) * SAMPLE_RATE);
      const [an, decoded] = await Promise.all([
        analyzeTrack(path),
        decodeTrack(path, { offset: m.offset, samples, fadeOut: m.fadeOut, sampleRate: SAMPLE_RATE }),
      ]);
      const envelopes = computeEnvelopes(decoded.audio, fps, frames);
      const raw = videoGrid(an.analysis, m.offset, spec.duration);
      // Phantom-beat trimming judges onset strength, so it stops where our own fade-out starts (the fade weakens
      // onsets of real beats). Beats in the fade and past the end only shape the last half-beats; they go when the
      // window's tail was phantom.
      const judged = (t: number) => t < spec.duration - m.fadeOut;
      const inBeats = raw.beats.filter(judged);
      const trim = trimEdgeBeats(
        { ...raw, beats: inBeats, downbeats: raw.downbeats.filter(judged) },
        beatStrengths(inBeats, envelopes.onset, fps),
      );
      const grid = trim.tail
        ? trim.grid
        : {
            ...trim.grid,
            beats: [...trim.grid.beats, ...raw.beats.filter((t) => !judged(t))],
            downbeats: [...trim.grid.downbeats, ...raw.downbeats.filter((t) => !judged(t))],
          };
      const sheet = buildCueSheet({ spec, choreography, fps, grid });
      const a = an.analysis;
      return {
        sheet: { ...sheet, envelopes },
        music: decoded.audio,
        detectedBeats: raw.beats,
        info: {
          source: 'track',
          file: m.file,
          path,
          sha256: a.source.sha256,
          offset: m.offset,
          fadeOut: m.fadeOut,
          covered: decoded.fromFile / SAMPLE_RATE,
          bpm: sheet.bpm!,
          beats: sheet.beats.length,
          downbeats: sheet.downbeats.length,
          meter: a.meter,
          meterConfidence: a.meter_confidence,
          downbeatsUsed: (a.meter_confidence ?? 0) >= MIN_METER_CONFIDENCE && trim.grid.downbeats.length > 0,
          trimmed: { head: trim.head, tail: trim.tail },
          analysis: { cached: an.cached, model: a.model.name, path: an.path, ms: an.ms },
          ms: performance.now() - start,
        },
      };
    }
    case 'ai':
      throw new Error('music source "ai" arrives in M7; use "preset", "track" or "none"');
  }
}

// ───────────────────────────── step 5: mix, master, loudness, AAC ─────────────────────────────

export interface AudioResult {
  /** AAC 256k in MP4 of the mix: normalised when there is music. */
  aac: string;
  /** AAC of the SFX stem alone for the `-no-music` copies, at the mix's gain; absent when that copy is silent. */
  noMusicAac?: string;
  /** Samples of the encoded stream before AAC framing: round(frames/fps · sr). */
  samples: number;
  sampleRate: number;
  /** SHA-256 of the float stems (`stereoSha`): music, SFX and the mastered mix. */
  hashes: { music?: string; sfx?: string; mix?: string };
  /** The mastered mix as 24-bit WAV (loudnorm's input). Absent for silence. */
  wav?: { path: string; sha256: string; samples: number };
  /** Measured on the encoded AAC (absent without music). */
  loudness?: Loudness;
  /** `linear` when loudnorm could reach the target without its dynamic mode. */
  normalization?: string;
  /**
   * Gain after `master` (dB): loudnorm's gain with music, the peak trim without. The `-no-music` SFX copy gets the
   * same, so its SFX sound as loud as inside the mix. Absent for silence.
   */
  gainDb?: number;
  ms: number;
}

let encoder: Promise<string> | undefined;
/**
 * AAC encoder: Apple AudioToolbox (`aac_at`) when this ffmpeg has it, else ffmpeg's native `aac`. M6: the native
 * encoder overshot a transient-heavy mix by 4 dB (true peak −3.5 → +0.5 dBTP after loudnorm, extrude-3d ×
 * mixed-niqqud); `aac_at` kept it at −3.4 and is bit-identical across runs.
 */
function aacEncoder(): Promise<string> {
  encoder ??= ffmpeg(['-encoders']).then(
    ({ stdout }) => (/\baac_at\b/.test(stdout) ? 'aac_at' : 'aac'),
    () => 'aac',
  );
  return encoder;
}

export async function finishAudio(o: {
  music: Stereo | null;
  sfx: Stereo | null;
  /** Write the SFX-only AAC for the `-no-music` copies (`spec.sfx` and `outputs.noMusic`). */
  noMusicSfx: boolean;
  frames: number;
  fps: number;
  workDir: string;
}): Promise<AudioResult> {
  const t0 = performance.now();
  const sr = SAMPLE_RATE;
  const duration = o.frames / o.fps;
  const samples = Math.round(duration * sr);
  const aac = join(o.workDir, 'audio.m4a');
  // exact length: pad/trim to `samples` after resampling loudnorm's 192 kHz output back to 48 kHz
  const fit = `aresample=${sr},apad=whole_len=${samples},atrim=end_sample=${samples}`;
  const codec = await aacEncoder();
  const enc = (out: string) => ['-c:a', codec, '-b:a', '256k', '-ar', String(sr), '-ac', '2', '-movflags', '+faststart', out];

  const hashes: AudioResult['hashes'] = {
    ...(o.music ? { music: stereoSha(o.music) } : {}),
    ...(o.sfx ? { sfx: stereoSha(o.sfx) } : {}),
  };
  const pre = mixStems(o.music, o.sfx, duration);
  if (!pre) {
    await ffmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${sr}:cl=stereo`, '-af', fit, ...enc(aac)]);
    return { aac, samples, sampleRate: sr, hashes, ms: performance.now() - t0 };
  }

  // kept for `masterScale` (the limiter may work in place)
  const preCopy = { l: pre.l.slice(), r: pre.r.slice() };
  const mastered = master(pre);
  hashes.mix = stereoSha(mastered);
  const wavBytes = encodeWav(mastered, 24);
  const wavPath = join(o.workDir, 'mix.wav');
  await writeFile(wavPath, wavBytes);

  let normalization: string | undefined;
  let gainDb: number;
  if (o.music) {
    const m = await measureLoudness(wavPath);
    const pass2 =
      `${LN}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}` +
      `:offset=${m.offset}:linear=true:print_format=json`;
    const { stderr } = await ffmpeg(['-y', '-i', wavPath, '-af', `${pass2},${fit}`, ...enc(aac)]);
    const out = loudnormJson(stderr);
    normalization = out.normalization_type;
    // linear mode applies exactly target − measured (af_loudnorm); dynamic mode only approximately its output − input
    gainDb = Math.round((normalization === 'linear' ? TARGET_LUFS - m.i : Number(out.output_i) - Number(out.input_i)) * 100) / 100;
  } else {
    // SFX alone are not loudness-normalised (sparse hits would be pushed far too loud); only the peak comes down
    gainDb = UNNORMALISED_TRIM_DB;
    await ffmpeg(['-y', '-v', 'error', '-i', wavPath, '-af', `volume=${gainDb}dB,${fit}`, ...enc(aac)]);
  }

  let noMusicAac: string | undefined;
  if (o.noMusicSfx && o.sfx) {
    if (!o.music) noMusicAac = aac;
    else {
      noMusicAac = join(o.workDir, 'sfx.m4a');
      const sfxPath = join(o.workDir, 'sfx.wav');
      // the SFX at the level they have inside the delivered mix: master's scale, then the mix's loudnorm gain, then
      // a sample-peak guard in case the SFX alone peak higher than inside the mix
      const g = masterScale(preCopy, mastered);
      await writeFile(sfxPath, encodeWav(mix([{ audio: o.sfx, gain: SFX_GAIN * g }], duration), 24));
      const guard = `alimiter=limit=${UNNORMALISED_PEAK}:level=false`;
      await ffmpeg(['-y', '-v', 'error', '-i', sfxPath, '-af', `volume=${gainDb}dB,${guard},${fit}`, ...enc(noMusicAac)]);
    }
  }

  return {
    aac,
    ...(noMusicAac ? { noMusicAac } : {}),
    samples,
    sampleRate: sr,
    hashes,
    wav: { path: wavPath, sha256: sha256(wavBytes), samples: mastered.l.length },
    gainDb,
    ...(o.music ? { loudness: await measureLoudness(aac) } : {}),
    ...(normalization ? { normalization } : {}),
    ms: performance.now() - t0,
  };
}

/**
 * The linear scale `master` applied, estimated by least squares over the samples below half the input peak (the
 * limiter only touches the loudest passages): Σ post·pre / Σ pre².
 */
function masterScale(pre: { l: Float32Array; r: Float32Array }, post: Stereo): number {
  let peak = 0;
  for (const ch of [pre.l, pre.r]) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  let num = 0;
  let den = 0;
  for (const [a, b] of [[pre.l, post.l], [pre.r, post.r]] as const) {
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      if (Math.abs(x) > peak / 2) continue;
      num += x * b[i]!;
      den += x * x;
    }
  }
  return den > 0 ? num / den : 1;
}

/**
 * Music + SFX stems summed with the delivery gains (before `master`); null when there is neither. The render
 * (`finishAudio`) and the live preview mix through this one function, so they sound the same.
 */
export function mixStems(music: Stereo | null, sfx: Stereo | null, duration: number): Stereo | null {
  const stems = [...(music ? [{ audio: music, gain: MUSIC_GAIN }] : []), ...(sfx ? [{ audio: sfx, gain: SFX_GAIN }] : [])];
  return stems.length ? mix(stems, duration) : null;
}
