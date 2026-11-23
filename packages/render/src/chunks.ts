/** Chunk plan, content-hashed chunk cache and the browser worker pool (PLAN.md §8.1, §8.4). */
import { mkdir, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Format, FormatId, ReelInput } from '@reel/core';
import type { Browser } from 'playwright';
import { GPU_ARGS, launchBrowser, ReelTab } from './capture.ts';
import { captureTimes, ChunkEncoder, ffmpegArgs, type QualitySettings } from './encode.ts';
import { REPO, sha256, stableJson } from './util.ts';

/**
 * Fixed chunk length: stable boundaries keep cached and fresh chunks in the same render order (M0a). Capture is
 * latency-bound, not CPU-bound, so short chunks over 8 workers beat long ones over 4 (M5, dilemma 9:16 final:
 * 10 s × 4 workers 424 s, 4 s × 4 345 s, 4 s × 8 196 s, 2 s × 12 249 s), and a date edit re-renders less.
 */
export const CHUNK_SECONDS = 4;
/** Default browser workers per job (see CHUNK_SECONDS). */
export const WORKERS = 8;
export const CHUNK_DIR = join(REPO, 'data/cache/chunks');

export interface ChunkPlan {
  index: number;
  /** Output frames [f0, f1). */
  f0: number;
  f1: number;
}

export function planChunks(frames: number, fps: number): ChunkPlan[] {
  const per = CHUNK_SECONDS * fps;
  const out: ChunkPlan[] = [];
  for (let f0 = 0, index = 0; f0 < frames; f0 += per, index++) out.push({ index, f0, f1: Math.min(frames, f0 + per) });
  return out;
}

/** Page-time window [t0, t1) a chunk captures from, including motion-blur sub-frames. */
export function chunkWindow(c: ChunkPlan, q: QualitySettings): [number, number] {
  return [captureTimes(c.f0, c.f0 + 1, q)[0]!, c.f1 / q.fps];
}

export interface KeyInput {
  bundleHash: string;
  chromium: string;
  format: Format;
  quality: QualitySettings;
  chunk: ChunkPlan;
  /** `reelPage.fingerprint(t0, t1)` for the chunk window. */
  fingerprint: unknown;
  /** Job-global look (palette, fonts, params): never content, so it cannot widen a date edit. */
  look: Pick<ReelInput, 'palette' | 'fonts' | 'params'>;
}

export function chunkKey(k: KeyInput): string {
  return sha256(
    stableJson({
      bundle: k.bundleHash,
      chromium: k.chromium,
      launch: GPU_ARGS,
      format: { id: k.format.id, w: k.format.w, h: k.format.h },
      quality: { ...k.quality, ffmpeg: ffmpegArgs({ out: '', w: k.format.w, h: k.format.h, q: k.quality }) },
      frames: [k.chunk.f0, k.chunk.f1],
      fingerprint: k.fingerprint ?? null,
      look: k.look,
    }),
  );
}

export const chunkPath = (key: string) => join(CHUNK_DIR, `${key}.mp4`);

export interface ChunkTask {
  format: FormatId;
  chunk: ChunkPlan;
  key: string;
  input: ReelInput;
}

export interface PoolOptions {
  workers: number;
  origin: string;
  entry: string;
  quality: QualitySettings;
  /** Output frames finished so far in a chunk. */
  onProgress(task: ChunkTask, frames: number): void;
  onDone(task: ChunkTask, ms: number): void;
}

/** Renders every task into the chunk cache: N browsers, each pulling the next chunk in order. */
export async function renderChunks(tasks: readonly ChunkTask[], o: PoolOptions): Promise<void> {
  await mkdir(CHUNK_DIR, { recursive: true });
  const queue = [...tasks];
  let failure: Error | null = null;
  const worker = async () => {
    if (!queue.length) return;
    const browser = await launchBrowser();
    try {
      for (let task = queue.shift(); task && !failure; task = queue.shift()) {
        const t0 = performance.now();
        await renderChunk(browser, task, o, () => failure);
        o.onDone(task, performance.now() - t0);
      }
    } catch (e) {
      failure ??= e as Error;
    } finally {
      await browser.close().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.workers, tasks.length)) }, worker));
  if (failure) throw failure;
}

async function renderChunk(
  browser: Browser,
  task: ChunkTask,
  o: PoolOptions,
  aborted: () => Error | null,
): Promise<void> {
  const q = o.quality;
  const { w, h } = task.input.format;
  const out = chunkPath(task.key);
  const tmp = `${out}.${process.pid}.tmp`;
  // A fresh context per chunk: chunk pixels depend only on the chunk's own frame order (M0a determinism).
  const tab = await ReelTab.open(browser, { origin: o.origin, entry: o.entry, input: task.input });
  const enc = new ChunkEncoder({ out: tmp, w, h, q });
  try {
    const times = captureTimes(task.chunk.f0, task.chunk.f1, q);
    const shot = { format: q.shot, quality: q.jpegQuality, scale: q.supersample };
    let n = 0;
    for await (const img of tab.captureRange(times, shot)) {
      const stop = aborted();
      if (stop) throw stop;
      await enc.write(img);
      if (++n % q.samples === 0) o.onProgress(task, n / q.samples);
    }
    await tab.check();
    await enc.finish();
    await rename(tmp, out);
  } catch (e) {
    enc.abort();
    await rm(tmp, { force: true });
    throw new Error(`${task.format} chunk ${task.chunk.index + 1}: ${(e as Error).message}`, { cause: e });
  } finally {
    await tab.close();
  }
}
