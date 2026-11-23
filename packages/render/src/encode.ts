/** Per-chunk ffmpeg encoder (PLAN.md §8.1, §8.3): image2pipe in, H.264 yuv420p BT.709 out, no frame files. */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { QUALITY_PRESETS, type JobSpec } from '@reel/core';

export type Preset = 'draft' | 'standard' | 'final';

export interface QualitySettings {
  /** Encoder preset; decides the codec settings (draft = VideoToolbox, standard/final = x264). */
  preset: Preset;
  fps: number;
  /** Sub-frames per output frame (1 = no motion blur). */
  samples: number;
  /** Shutter angle in degrees (used when samples > 1). */
  shutter: number;
  supersample: number;
  /** Intermediate image codec piped from the browser. */
  shot: 'jpeg' | 'png';
  jpegQuality: number;
}

export interface EncodeOptions {
  out: string;
  w: number;
  h: number;
  q: QualitySettings;
}

/** Spec quality (preset name or custom object) → concrete capture/encode settings. */
export function resolveQuality(q: JobSpec['quality']): QualitySettings {
  const shot = { shot: 'jpeg', jpegQuality: 95 } as const; // M0: JPEG q95 is the default intermediate
  if (typeof q === 'string') {
    const p = QUALITY_PRESETS[q];
    return {
      preset: q,
      fps: p.fps,
      samples: p.motionBlur?.samples ?? 1,
      shutter: p.motionBlur?.shutter ?? 180,
      supersample: p.supersample,
      ...shot,
    };
  }
  return {
    // custom settings use the hero encoder when they ask for hero-grade capture
    preset: q.motionBlur || q.supersample > 1 ? 'final' : 'standard',
    fps: q.fps,
    samples: q.motionBlur?.samples ?? 1,
    shutter: q.motionBlur?.shutter ?? 180,
    supersample: q.supersample,
    ...shot,
  };
}

const CODEC: Record<Preset, string[]> = {
  // VideoToolbox: constant-quality mode (M0: q70 ≈ 4 s per 780 frames); `-allow_sw 0` keeps it on the hardware path.
  draft: ['-c:v', 'h264_videotoolbox', '-q:v', '70', '-profile:v', 'high', '-allow_sw', '0'],
  standard: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high'],
  final: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high'],
};

export function ffmpegArgs({ out, w, h, q }: EncodeOptions): string[] {
  const s = q.samples;
  const vf: string[] = [];
  if (s > 1) vf.push(`tmix=frames=${s}`, `select='eq(mod(n\\,${s})\\,${s - 1})'`, `setpts=N/(${q.fps}*TB)`);
  vf.push(
    `scale=${w}:${h}:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
    'format=yuv420p',
    // ffmpeg 9 takes primaries/transfer from the frames, which arrive unspecified from mjpeg/png: tag them here
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
  );
  const gop = String(q.fps * 2);
  const x264 = q.preset === 'draft' ? [] : ['-x264-params', `open-gop=0:keyint=${gop}:min-keyint=${gop}:scenecut=0`];
  return [
    '-hide_banner', '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(q.fps * s), '-c:v', q.shot === 'jpeg' ? 'mjpeg' : 'png', '-i', '-',
    '-vf', vf.join(','),
    '-r', String(q.fps), '-fps_mode', 'cfr',
    ...CODEC[q.preset],
    '-g', gop, ...x264, '-flags', '+cgop',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-an', '-f', 'mp4', out,
  ];
}

/** One ffmpeg per chunk; `write` honours stdin backpressure. */
export class ChunkEncoder {
  readonly #ff: ChildProcessByStdio<Writable, null, Readable>;
  readonly #done: Promise<void>;
  #stderr = '';

  constructor(o: EncodeOptions) {
    this.#ff = spawn('ffmpeg', ffmpegArgs(o), { stdio: ['pipe', 'ignore', 'pipe'] });
    this.#ff.stderr.on('data', (b: Buffer) => (this.#stderr += b.toString()));
    // EPIPE on stdin surfaces through `close` below with ffmpeg's own error message.
    this.#ff.stdin.on('error', () => {});
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.#ff.on('error', reject);
    this.#ff.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg encode failed (${signal ?? code}): ${this.#stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
    this.#done = promise;
    this.#done.catch(() => {}); // observed via finish()/write(); avoid an unhandled rejection meanwhile
  }

  async write(img: Uint8Array): Promise<void> {
    if (this.#ff.exitCode !== null) await this.#done;
    if (this.#ff.stdin.write(img)) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    const onDrain = () => resolve();
    this.#ff.stdin.once('drain', onDrain);
    await Promise.race([promise, this.#done]).finally(() => this.#ff.stdin.off('drain', onDrain));
  }

  async finish(): Promise<void> {
    this.#ff.stdin.end();
    await this.#done;
  }

  abort(): void {
    this.#ff.kill('SIGKILL');
  }
}

/** Page times of every capture (sub-frames included) for output frames [f0, f1) — PLAN.md §8.3 shutter formula. */
export function captureTimes(f0: number, f1: number, q: Pick<QualitySettings, 'fps' | 'samples' | 'shutter'>): number[] {
  const out: number[] = [];
  const S = q.samples;
  const shutter = q.shutter / 360;
  for (let f = f0; f < f1; f++) {
    if (S <= 1) out.push(f / q.fps);
    else for (let s = 0; s < S; s++) out.push(Math.max(0, (f + ((s + 0.5) / S) * shutter - shutter / 2) / q.fps));
  }
  return out;
}
