/**
 * AI music add-on (PLAN.md §8.2, M7): ACE-Step 1.5 in its own uv project (`sidecar/music-ai/`), checkpoints in
 * `assets/models/ace-step/` (`reelgen setup music-ai`). Optional: nothing else imports the sidecar or needs it.
 *
 * `generateMusicAi` turns (prompt, lyrics, seed, bpm hint, length) into a 48 kHz float WAV cached in
 * `data/cache/music-ai/<key>.wav`, keyed by those inputs and the model hash (pinned checkpoints + pinned ACE-Step +
 * generator script). A spec re-renders from that file bit-identically. Like the analysis cache it is never pruned (a
 * clip costs about a minute of GPU time and may not regenerate bit-identically elsewhere); delete the folder to free
 * it. From the WAV on, the render treats the clip exactly like an own track (`audio.ts`).
 */
import { access, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { aiClipSeconds, type JobSpec } from '@reel/core';
import { MODEL_PATH as BEAT_MODEL_PATH, run, setupAnalysis } from './analysis.ts';
import { SetupError } from './samples.ts';
import { REPO, sha256, stableJson, writeAtomic } from './util.ts';

export const MUSIC_AI_DIR = join(REPO, 'sidecar/music-ai');
export const ACE_MODEL_DIR = join(REPO, 'assets/models/ace-step');
export const MUSIC_AI_CACHE = join(REPO, 'data/cache/music-ai');
const PYTHON = join(MUSIC_AI_DIR, '.venv/bin/python');
const ACESTEP_PKG = join(MUSIC_AI_DIR, '.venv/lib/python3.12/site-packages/acestep');
const STAMP = join(ACE_MODEL_DIR, '.reel-verified.json');
const SETUP_HINT = 'run `reelgen setup music-ai` (ACE-Step 1.5: a ~1.4 GB Python environment and ~10 GB of checkpoints)';

interface ModelManifest {
  repo: string;
  revision: string;
  files: { path: string; bytes: number; sha256?: string; gitSha1?: string }[];
}

let modelHash: Promise<string> | undefined;
/** What the clip depends on besides its inputs: the pinned checkpoints, the pinned ACE-Step build and the generator. */
export function musicAiModelHash(): Promise<string> {
  modelHash ??= Promise.all(['models.json', 'uv.lock', 'generate.py'].map((f) => readFile(join(MUSIC_AI_DIR, f)))).then((bs) =>
    sha256(Buffer.concat(bs.flatMap((b, i) => [Buffer.from(`${i}:${b.length}:`), b]))),
  );
  return modelHash;
}

/** Whether the add-on is installed: the environment and every pinned checkpoint file verified by setup. */
export async function musicAiInstalled(): Promise<boolean> {
  const exists = (p: string) => access(p).then(() => true, () => false);
  if (!(await exists(PYTHON)) || !(await exists(ACESTEP_PKG))) return false;
  const [manifest, stamp] = await Promise.all([
    readFile(join(MUSIC_AI_DIR, 'models.json'), 'utf8').then((s) => JSON.parse(s) as ModelManifest),
    readFile(STAMP, 'utf8').then((s) => JSON.parse(s) as { revision: string; files: Record<string, unknown> }, () => null),
  ]);
  return !!stamp && stamp.revision === manifest.revision && manifest.files.every((f) => f.path in stamp.files);
}

/** Add-on and the beat analysis it relies on. */
export async function musicAiReady(): Promise<boolean> {
  const [ai, beats] = await Promise.all([
    musicAiInstalled(),
    Promise.all([access(join(REPO, 'sidecar/.venv/bin/python')), access(BEAT_MODEL_PATH)]).then(() => true, () => false),
  ]);
  return ai && beats;
}

const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;

async function dirBytes(path: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(path, { recursive: true, withFileTypes: true }).catch(() => [])) {
    if (e.isFile()) n += (await stat(join(e.parentPath, e.name)).catch(() => ({ size: 0 }))).size;
  }
  return n;
}

/**
 * `reelgen setup music-ai`: the beat analysis (idempotent), `uv sync --frozen` in `sidecar/music-ai/`, then every
 * pinned checkpoint downloaded and hash-checked (`fetch_models.py`), then a summary. Re-running verifies and skips.
 */
export async function setupMusicAi(log: (msg: string) => void): Promise<void> {
  await setupAnalysis(log);
  log('music-ai: uv sync (sidecar/music-ai/, Python 3.12 + ACE-Step 1.5 @ ca1e85f + torch + mlx; first install ~1.4 GB)');
  const sync = await run('uv', ['sync', '--frozen'], { cwd: MUSIC_AI_DIR, log: (l) => log(`  ${l}`) });
  if (sync.code !== 0) {
    throw new Error(sync.code === -1 ? `uv is not installed (${sync.stderr}); install it from https://docs.astral.sh/uv/` : `uv sync failed in ${MUSIC_AI_DIR}`);
  }
  const manifest = JSON.parse(await readFile(join(MUSIC_AI_DIR, 'models.json'), 'utf8')) as ModelManifest;
  const total = manifest.files.reduce((s, f) => s + f.bytes, 0);
  log(`music-ai: checkpoints ${manifest.repo}@${manifest.revision.slice(0, 7)} (${manifest.files.length} files, ${gb(total)}) → ${ACE_MODEL_DIR}`);
  for (const f of manifest.files.filter((f) => f.bytes > 50e6)) log(`  ${f.path}  ${gb(f.bytes)}  sha256 ${f.sha256!.slice(0, 12)}…`);
  let last = -1;
  let summary = '';
  const r = await run(PYTHON, [join(MUSIC_AI_DIR, 'fetch_models.py'), ACE_MODEL_DIR], {
    log: (line) => {
      const m = /^progress (\d+) (\d+)$/.exec(line);
      if (m) {
        const pct = Math.floor((100 * Number(m[1])) / Number(m[2]));
        if (pct >= last + 10 || pct === 100) {
          last = pct;
          log(`  ${pct}% verified`);
        }
      } else if (line.startsWith('{')) summary = line;
      else if (line.startsWith('download ') || line.startsWith('hash mismatch')) log(`  ${line}`);
    },
  });
  if (r.code !== 0) throw new Error(`music-ai: checkpoint download/verification failed:\n${r.stderr.trim().split('\n').slice(-4).join('\n')}`);
  const s = JSON.parse(summary || '{}') as { downloaded?: number; seconds?: number };
  const [venv, models] = await Promise.all([dirBytes(join(MUSIC_AI_DIR, '.venv')), dirBytes(ACE_MODEL_DIR)]);
  log(
    `music-ai: ready · environment ${gb(venv)} · checkpoints ${gb(models)} (${s.downloaded ? `${gb(s.downloaded)} downloaded` : 'already present'}, ` +
      `all SHA-256/git hashes verified) · model hash ${(await musicAiModelHash()).slice(0, 12)}`,
  );
  log('music-ai: use it with "music": { "source": "ai", "prompt": "…", "seed": 1 } (first clip ~1 min on Apple Silicon)');
}

export interface MusicAiRequest {
  prompt: string;
  lyrics?: string | undefined;
  bpm?: number | undefined;
  seed: number;
  /** Clip length to generate, whole seconds (`aiClipSeconds` of the spec). */
  seconds: number;
}

export interface MusicAiResult {
  path: string;
  cached: boolean;
  /** Cache key (also the file name). */
  key: string;
  /** Generated clip length, seconds. */
  duration: number;
  ms: number;
  /** Sidecar timings of a fresh generation. */
  timings?: { load_s: number; generate_s: number; total_s: number; device: string; mlx: boolean };
}

/** The clip a spec's `music: { source: 'ai' }` names. */
export function aiClip(spec: JobSpec): MusicAiRequest {
  const m = spec.music;
  if (m.source !== 'ai') throw new Error(`music source is "${m.source}", not "ai"`);
  return {
    prompt: m.prompt,
    ...(m.lyrics?.trim() ? { lyrics: m.lyrics } : {}),
    ...(m.bpm !== undefined ? { bpm: m.bpm } : {}),
    seed: m.seed,
    seconds: aiClipSeconds(spec.duration, m.offset),
  };
}

export async function musicAiKey(r: MusicAiRequest): Promise<{ key: string; duration: number }> {
  const duration = Math.max(10, Math.ceil(r.seconds));
  const key = sha256(stableJson({ v: 1, model: await musicAiModelHash(), prompt: r.prompt.trim(), lyrics: r.lyrics?.trim() ?? '', bpm: r.bpm ?? null, seed: r.seed, duration }));
  return { key, duration };
}

/** The cached clip for this request, or null. */
export async function cachedMusicAi(r: MusicAiRequest): Promise<string | null> {
  const { key } = await musicAiKey(r);
  const path = join(MUSIC_AI_CACHE, `${key}.wav`);
  return access(path).then(() => path, () => null);
}

const inflight = new Map<string, Promise<MusicAiResult>>();

/**
 * The clip from the cache, or a fresh ACE-Step run (one at a time per key). `onProgress(0..1, stage)` follows the
 * sidecar; a missing install is a `SetupError` naming the setup command.
 */
export async function generateMusicAi(r: MusicAiRequest, onProgress?: (p: number, stage: string) => void): Promise<MusicAiResult> {
  const t0 = performance.now();
  const { key, duration } = await musicAiKey(r);
  const path = join(MUSIC_AI_CACHE, `${key}.wav`);
  if (await access(path).then(() => true, () => false)) return { path, cached: true, key, duration, ms: performance.now() - t0 };
  let job = inflight.get(key);
  if (!job) {
    job = (async (): Promise<MusicAiResult> => {
      if (!(await musicAiInstalled())) throw new SetupError(`AI music is not set up; ${SETUP_HINT}`);
      await mkdir(MUSIC_AI_CACHE, { recursive: true });
      const tmp = join(MUSIC_AI_CACHE, `${key}.${process.pid}.tmp.wav`);
      const args = [join(MUSIC_AI_DIR, 'generate.py'), '--models', ACE_MODEL_DIR, '--prompt', r.prompt.trim(), '--duration', String(duration), '--seed', String(r.seed), '-o', tmp];
      if (r.lyrics?.trim()) args.push('--lyrics', r.lyrics.trim());
      if (r.bpm !== undefined) args.push('--bpm', String(Math.round(r.bpm)));
      let timings: MusicAiResult['timings'];
      let shown = -1;
      try {
        // cwd: ACE-Step writes `.cache/acestep/progress_estimates.json` under its working directory
        const res = await run(PYTHON, args, {
          cwd: MUSIC_AI_DIR,
          log: (line) => {
            const m = /^progress ([\d.]+) (.*)$/.exec(line);
            if (m) {
              const p = Number(m[1]);
              // the sidecar repeats its stage line on every step; pass on changes of ≥ 1 %
              if (p - shown >= 0.01 || p === 1) {
                shown = p;
                onProgress?.(p, m[2]!);
              }
            } else if (line.startsWith('{')) timings = JSON.parse(line) as MusicAiResult['timings'];
          },
        });
        const why = res.stderr.trim().split('\n').filter((l) => !/it\/s|s\/it|%\|/.test(l)).slice(-4).join('\n');
        if (res.code === 4) throw new SetupError(`AI music: ${why}; ${SETUP_HINT}`);
        if (res.code !== 0) throw new Error(`AI music generation failed (exit ${res.code}):\n${why}`);
        await rename(tmp, path);
        await writeAtomic(join(MUSIC_AI_CACHE, `${key}.json`), JSON.stringify({ ...r, duration, timings }, null, 1));
      } finally {
        await rm(tmp, { force: true });
      }
      return { path, cached: false, key, duration, ms: performance.now() - t0, ...(timings ? { timings } : {}) };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}
