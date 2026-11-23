/**
 * Own-track music source (PLAN.md §7, §8.2): resolve the asset, decode the video's window of it to 48 kHz stereo,
 * fade it out, and move the sidecar's beats into video time.
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Stereo } from '@reel/audio';
import type { BeatGrid } from '@reel/timing';
import type { TrackAnalysis } from './analysis.ts';

/** Lookup order when several files share the asset id. */
export const TRACK_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] as const;
/** Detected beats this far past the end of the video still shape the grid (the last half-beats interpolate). */
const GRID_MARGIN_S = 2;

/** `<specDir>/assets/<file>.<ext>`, trying `TRACK_EXTS` in order. */
export async function resolveTrack(specDir: string, file: string): Promise<string> {
  const tried = TRACK_EXTS.map((ext) => join(specDir, 'assets', `${file}.${ext}`));
  for (const path of tried) if (await access(path).then(() => true, () => false)) return path;
  throw new Error(`music track "${file}" not found; looked for ${tried.join(', ')}`);
}

export interface DecodedTrack {
  audio: Stereo;
  /** Samples that came from the file; the rest (track shorter than offset + duration) is silence. */
  fromFile: number;
}

/**
 * `samples` frames of the file starting at `offset` seconds, 48 kHz stereo float, bit-identical to the samples
 * `round(offset·sr)…` of a full decode (checked in `track.test.ts`).
 *
 * ffmpeg's input `-ss` is sample-accurate, but a lossy decoder (MP3, AAC) needs a few frames to warm up after a seek:
 * cutting right at `offset` measured errors up to 0.25 in the first ~80 ms. So the decode starts at a whole second
 * ≥ 1 s before `offset` (whole seconds are whole samples at any rate) and drops the pre-roll here.
 * The last `fadeOut` seconds fade to silence along (1 − x)².
 */
export async function decodeTrack(
  path: string,
  o: { offset: number; samples: number; fadeOut: number; sampleRate: number },
): Promise<DecodedTrack> {
  const sr = o.sampleRate;
  const pre = Math.max(0, Math.floor(o.offset) - 1);
  const skip = Math.round(o.offset * sr) - pre * sr;
  // one second of margin: `-t` is a container duration, the exact cut happens below
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(pre), '-t', String((skip + o.samples) / sr + 1), '-i', path];
  args.push('-map', 'a:0', '-ac', '2', '-af', `aresample=${sr}`, '-f', 'f32le', '-c:a', 'pcm_f32le', '-');
  const done = Promise.withResolvers<Buffer>();
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on('data', (b: Buffer) => out.push(b));
  child.stderr.on('data', (b: Buffer) => err.push(b));
  child.on('error', done.reject);
  child.on('close', (code) =>
    code === 0
      ? done.resolve(Buffer.concat(out))
      : done.reject(new Error(`cannot decode the track ${path}: ${Buffer.concat(err).toString().trim()}`)),
  );
  const pcm = await done.promise;
  const frames = Math.floor(pcm.length / 8) - skip;
  const fromFile = Math.max(0, Math.min(frames, o.samples));
  const l = new Float32Array(o.samples);
  const r = new Float32Array(o.samples);
  for (let i = 0; i < fromFile; i++) {
    l[i] = pcm.readFloatLE((skip + i) * 8);
    r[i] = pcm.readFloatLE((skip + i) * 8 + 4);
  }
  const fade = Math.min(o.samples, Math.round(o.fadeOut * sr));
  for (let i = o.samples - fade; i < o.samples; i++) {
    const x = (o.samples - 1 - i) / fade;
    l[i]! *= x * x;
    r[i]! *= x * x;
  }
  return { audio: { l, r, sampleRate: sr }, fromFile };
}

/**
 * The sidecar's beats (file time) moved into video time: `t − offset`, kept from 0 to `duration + GRID_MARGIN_S`.
 * Times are rounded to 1 µs like the cue sheet.
 */
export function videoGrid(a: TrackAnalysis, offset: number, duration: number): BeatGrid {
  const shift = (ts: number[]) =>
    ts.map((t) => Math.round((t - offset) * 1e6) / 1e6).filter((t) => t >= 0 && t < duration + GRID_MARGIN_S);
  return { beats: shift(a.beats), downbeats: shift(a.downbeats), meterConfidence: a.meter_confidence ?? 0 };
}

/**
 * Onset strength at each beat: the max of the onset envelope over the beat's frame and its neighbours (the detector's
 * 20 ms grid can put a beat one frame early or late). Beats past the envelope's end get the median, so they never
 * count as weak.
 */
export function beatStrengths(beats: number[], onset: number[], fps: number): number[] {
  const raw = beats.map((t) => {
    const f = Math.floor(t * fps);
    if (f >= onset.length) return NaN;
    return Math.max(onset[f - 1] ?? 0, onset[f] ?? 0, onset[f + 1] ?? 0);
  });
  const known = raw.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y);
  const median = known.length ? known[Math.floor((known.length - 1) / 2)]! : 0;
  return raw.map((x) => (Number.isNaN(x) ? median : x));
}
