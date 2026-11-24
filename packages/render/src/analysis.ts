/**
 * Track analysis (PLAN.md §7, §11): the `sidecar/` uv project runs Beat This! `final0` on the full track and prints
 * beats, downbeats, tempo and meter. Results are cached per audio SHA-256 + model SHA-256 in
 * `data/cache/analysis/<key>.json`; the trim to the video window is a pure function of that file (done in `track.ts`).
 *
 * The checkpoint is a local file (`assets/models/`) installed by `reelgen setup analysis`; nothing is fetched at
 * render time.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadVerified, SetupError } from './samples.ts';
import { REPO, sha256, writeAtomic } from './util.ts';

export const SIDECAR_DIR = join(REPO, 'sidecar');
export const MODEL_DIR = join(REPO, 'assets/models');
export const ANALYSIS_DIR = join(REPO, 'data/cache/analysis');

/** Beat This! final0 (CPJKU, ISMIR 2024): the URL `beat_this.inference.CHECKPOINT_URL` resolves `final0` to. */
export const BEAT_MODEL = {
  name: 'beat_this:final0',
  file: 'beat_this-final0.ckpt',
  url: 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt',
  sha256: '8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331',
  bytes: 81_058_141,
} as const;
export const MODEL_PATH = join(MODEL_DIR, BEAT_MODEL.file);
const PYTHON = join(SIDECAR_DIR, '.venv/bin/python');

/** Sidecar JSON (`sidecar/analyze.py`); times in seconds from the start of the file. */
export interface TrackAnalysis {
  version: 1;
  beats: number[];
  downbeats: number[];
  /** Median-IBI tempo; null with fewer than 2 beats. */
  bpm: number | null;
  /** Mode of beats per bar; null with fewer than 2 downbeats. */
  meter: number | null;
  /** Share of bars with `meter` beats (0..1). */
  meter_confidence: number | null;
  duration: number;
  source: { sha256: string };
  model: { name: string; sha256: string };
}

const SETUP_HINT = 'run `reelgen setup analysis` (installs the beat-tracking sidecar, ~720 MB, and its 81 MB model)';

/** Runs a sidecar process, streaming its non-empty output lines to `log`; resolves with the exit code and stderr. */
export function run(cmd: string, args: string[], o: { cwd?: string; log?: (line: string) => void } = {}) {
  const { promise, resolve } = Promise.withResolvers<{ code: number; stderr: string }>();
  const child = spawn(cmd, args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const err: Buffer[] = [];
  const onLine = (b: Buffer) => {
    for (const line of b.toString().split('\n')) if (line.trim()) o.log?.(line.trimEnd());
  };
  child.stdout.on('data', onLine);
  child.stderr.on('data', (b: Buffer) => {
    err.push(b);
    onLine(b);
  });
  child.on('error', (e) => resolve({ code: -1, stderr: e.message }));
  child.on('close', (code) => resolve({ code: code ?? -1, stderr: Buffer.concat(err).toString() }));
  return promise;
}

/** `uv sync` in `sidecar/` (pinned by its `uv.lock`), then the checkpoint download with its SHA-256 check. */
export async function setupAnalysis(log: (msg: string) => void): Promise<void> {
  log('analysis: uv sync (sidecar/, Python 3.12 + beat-this 1.1.0 + torch; the first install takes a few minutes)');
  const sync = await run('uv', ['sync', '--frozen'], { cwd: SIDECAR_DIR, log: (l) => log(`  ${l}`) });
  if (sync.code !== 0) {
    throw new Error(
      sync.code === -1 ? `uv is not installed (${sync.stderr}); install it from https://docs.astral.sh/uv/` : `uv sync failed in ${SIDECAR_DIR}`,
    );
  }
  log(`analysis: model ${BEAT_MODEL.name} (${(BEAT_MODEL.bytes / 1e6).toFixed(0)} MB) → ${MODEL_PATH}`);
  const n = await downloadVerified(BEAT_MODEL.url, MODEL_PATH, BEAT_MODEL.sha256, `model ${BEAT_MODEL.name}`);
  log(`analysis: model ${n ? 'downloaded and' : 'already'} verified (sha256 ${BEAT_MODEL.sha256.slice(0, 12)}…)`);
}

/** `beat_this` inside the venv: present only once `uv sync` completed (the interpreter appears first). */
const BEAT_THIS_PKG = join(SIDECAR_DIR, '.venv/lib/python3.12/site-packages/beat_this');

async function checkSetup(): Promise<void> {
  const exists = (p: string) => access(p).then(() => true, () => false);
  const missing: string[] = [];
  if (!(await exists(PYTHON)) || !(await exists(BEAT_THIS_PKG))) missing.push(`the sidecar environment (${join(SIDECAR_DIR, '.venv')})`);
  if (!(await exists(MODEL_PATH))) missing.push(`the model checkpoint (${MODEL_PATH})`);
  if (missing.length) {
    throw new SetupError(`track analysis is not set up: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing; ${SETUP_HINT}`);
  }
}

export interface AnalysisResult {
  analysis: TrackAnalysis;
  cached: boolean;
  /** Cache file. */
  path: string;
  ms: number;
}

/** Beats of the whole file at `audioPath`, from the cache or a fresh sidecar run. */
export async function analyzeTrack(audioPath: string): Promise<AnalysisResult> {
  const t0 = performance.now();
  const audioSha = sha256(await readFile(audioPath));
  const path = join(ANALYSIS_DIR, `${audioSha}-${BEAT_MODEL.sha256.slice(0, 16)}.json`);
  const cached = await readFile(path, 'utf8').then((s) => JSON.parse(s) as TrackAnalysis, () => null);
  if (cached) return { analysis: cached, cached: true, path, ms: performance.now() - t0 };

  await checkSetup();
  await mkdir(ANALYSIS_DIR, { recursive: true });
  const tmp = `${path}.${process.pid}.out`;
  try {
    const r = await run(PYTHON, [join(SIDECAR_DIR, 'analyze.py'), audioPath, '--model', MODEL_PATH, '-o', tmp]);
    const why = r.stderr.trim().split('\n').slice(-4).join('\n');
    if (r.code === 4) throw new SetupError(`track analysis: ${why}; ${SETUP_HINT}`);
    if (r.code === 3) throw new Error(`cannot decode the track ${audioPath}: ${why}`);
    if (r.code !== 0) throw new Error(`track analysis failed (exit ${r.code}) for ${audioPath}:\n${why}`);
    const text = await readFile(tmp, 'utf8');
    const analysis = JSON.parse(text) as TrackAnalysis;
    if (analysis.source.sha256 !== audioSha) throw new Error(`track analysis: the sidecar analysed different bytes than ${audioPath}`);
    if (analysis.model.sha256 !== BEAT_MODEL.sha256) {
      throw new SetupError(`track analysis: model checkpoint ${MODEL_PATH} does not match its SHA-256; ${SETUP_HINT}`);
    }
    await writeAtomic(path, text);
    return { analysis, cached: false, path, ms: performance.now() - t0 };
  } finally {
    await rm(tmp, { force: true });
  }
}
