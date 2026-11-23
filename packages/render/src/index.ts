/**
 * `renderJob`: spec → cue sheet → bundle → preflight QA → chunk render (cached) → audio → assemble → post QA
 * (PLAN.md §8). Emits typed events for the CLI; returns the receipt that is also written next to the outputs.
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type FormatId,
  JobSpec,
  formatSlug,
  type CueSheet,
  type ReelInput,
  type ResolvedPalette,
} from '@reel/core';
import { RECIPES, recipe } from '@reel/styles';
import { formatDiagnostics, resolveStyles, TRAIT_META, usedTraits, type StyleResolution } from '@reel/traits';
import { buildCueSheet } from '@reel/timing';
import { assemble, type Exported } from './assemble.ts';
import { renderAudio, type AudioResult } from './audio.ts';
import { buildBundle, type Bundle } from './bundle.ts';
import type { Browser } from 'playwright';
import { launchBrowser, ReelTab } from './capture.ts';
import { chunkKey, chunkPath, chunkWindow, planChunks, renderChunks, type ChunkPlan, type ChunkTask } from './chunks.ts';
import { resolveQuality, type Preset, type QualitySettings } from './encode.ts';
import {
  gateAudio,
  gateBounds,
  gateContainer,
  gateContrast,
  gateDeterminism,
  gateFidelity,
  gateLoudness,
  gateOverlap,
  gateWeekday,
  probe,
  sampleHolds,
  type GateResult,
  type ProbeSummary,
} from './qa.ts';
import { reelInput } from './reel-input.ts';
import { serveDir } from './server.ts';
import { exec, REPO, sha256, writeAtomic } from './util.ts';

export { ensureFonts, FONT_DIR } from './fonts.ts';
export { CHUNK_DIR } from './chunks.ts';
export type { GateResult, Level, ProbeSummary } from './qa.ts';
export type { Exported } from './assemble.ts';
export type { Preset, QualitySettings } from './encode.ts';

export const DATA_DIR = join(REPO, 'data');
export const JOBS_DIR = join(DATA_DIR, 'jobs');
export const OUT_DIR = join(REPO, 'out');

export interface RenderOptions {
  quality?: Preset;
  formats?: FormatId[];
  workers?: number;
  /** Root for outputs; the job writes into `<outDir>/<job-id>/`. */
  outDir?: string;
  /** `false` re-renders every chunk (results still refresh the cache). */
  cache?: boolean;
}

export type Phase = 'preflight' | 'post';

export type RenderEvent =
  | { type: 'spec'; job: string; sections: number; duration: number; bpm: number; fps: number; quality: string; formats: FormatId[] }
  | { type: 'bundle'; hash: string; chromium: string; ms: number }
  | { type: 'qa'; phase: Phase; result: GateResult }
  | {
      type: 'audio';
      /** `lofi-jazz seed 1101` or `none`. */
      source: string;
      duration: number;
      /** Score WAV hash (absent for silence). */
      sha256?: string;
      notes?: number;
      lufs?: number;
      tp?: number;
      normalization?: string;
      ms: number;
    }
  | { type: 'plan'; format: FormatId; chunks: { index: number; frames: number; cached: boolean }[] }
  | { type: 'chunk'; format: FormatId; index: number; done: number; total: number }
  | { type: 'chunk-done'; format: FormatId; index: number; ms: number }
  | { type: 'rendered'; rendered: number; cached: number; ms: number }
  | { type: 'export'; exported: Exported; ms: number }
  | { type: 'done'; receipt: string; outDir: string; ms: number };

/** A gate at level `fail`: the job stops; `qa.json` has been written. */
export class QaError extends Error {
  readonly results: GateResult[];
  constructor(results: GateResult[], qaPath: string) {
    const failed = results.filter((r) => r.level === 'fail');
    super(`QA failed (${failed.map((r) => r.gate + (r.format ? ` ${r.format}` : '')).join(', ')}); see ${qaPath}`);
    this.name = 'QaError';
    this.results = results;
  }
}

/** The spec file is not valid JSON or does not match the schema. */
export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecError';
  }
}

export interface ChunkRecord extends ChunkPlan {
  key: string;
  cached: boolean;
  ms?: number;
}

export interface Receipt {
  job: string;
  spec: { path: string; sha256: string };
  /** The job style's dominant recipe. */
  style: string;
  /** Per-section resolved styles, scene layers and resolver diagnostics (e.g. transition fallbacks). */
  styles: Pick<StyleResolution, 'sections' | 'scenes' | 'diagnostics'>;
  quality: QualitySettings;
  bpm: number;
  duration: number;
  frames: number;
  bundle: { hash: string };
  chromium: string;
  ffmpeg: string;
  audio: { source: string; wavSha256?: string; aacSha256: string; notes?: number; lufs?: number; tp?: number; normalization?: string };
  formats: Partial<Record<FormatId, { chunks: ChunkRecord[]; outputs: Exported; probe: ProbeSummary }>>;
  qa: GateResult[];
  timings: Record<string, number>;
  outDir: string;
}

const ms = (since: number) => Math.round(performance.now() - since);

async function loadSpec(path: string): Promise<{ spec: JobSpec; bytes: Buffer }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new SpecError(`cannot read job spec ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    throw new SpecError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = JobSpec.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.length ? i.path.join('.') : '(spec)'}: ${i.message}`);
    throw new SpecError(`${path} is not a valid job spec:\n${lines.join('\n')}`);
  }
  return { spec: parsed.data, bytes };
}

export function renderJob(specPath: string, opts: RenderOptions, emit: (e: RenderEvent) => void): Promise<Receipt> {
  return renderJobWith(specPath, opts, emit, buildBundle);
}

/** `renderJob` with the bundle step swapped out: the fixture-page tests render through the real pipeline. */
export async function renderJobWith(
  specPath: string,
  opts: RenderOptions,
  emit: (e: RenderEvent) => void,
  makeBundle: typeof buildBundle,
): Promise<Receipt> {
  const start = performance.now();
  const timings: Record<string, number> = {};
  const absSpec = resolve(specPath);
  const specDir = dirname(absSpec);
  const loaded = await loadSpec(absSpec);
  const spec: JobSpec = {
    ...loaded.spec,
    ...(opts.quality ? { quality: opts.quality } : {}),
    ...(opts.formats ? { formats: opts.formats } : {}),
  };

  // ── styles (traits, blends, compatibility, scene layers), tempo, cue sheet ──
  const styles = resolveStyles(spec, RECIPES, TRAIT_META);
  const styleErrors = styles.diagnostics.filter((d) => d.level === 'error');
  if (styleErrors.length || !styles.job) throw new SpecError(`${absSpec}: style resolution failed:\n${formatDiagnostics(styleErrors)}`);
  const styleId = styles.job.recipe;
  const rec = recipe(styleId);
  const music = spec.music;
  if (music.source === 'track' || music.source === 'ai') {
    throw new SpecError(`music source "${music.source}" arrives in M3; use "preset" or "none" for now`);
  }
  const bpm = music.source === 'preset' ? music.bpm : rec.defaults.music.bpm;
  const q = resolveQuality(spec.quality);
  const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm, fps: q.fps });
  emit({
    type: 'spec',
    job: spec.id,
    sections: spec.sections.length,
    duration: sheet.duration,
    bpm,
    fps: q.fps,
    quality: typeof spec.quality === 'string' ? spec.quality : 'custom',
    formats: spec.formats,
  });

  const jobDir = join(JOBS_DIR, spec.id);
  const outDir = join(resolve(opts.outDir ?? OUT_DIR), spec.id);
  await mkdir(jobDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  // ── bundle + browsers ──
  let t = performance.now();
  const bundle = await makeBundle({ spec, specDir, outDir: join(jobDir, 'bundle'), traits: usedTraits(styles) });
  const server = await serveDir(bundle.dir);
  const probeBrowser = await launchBrowser();
  const ctx: Ctx = {
    spec,
    sheet,
    q,
    bundle,
    origin: server.url,
    chromium: probeBrowser.version(),
    cache: opts.cache ?? true,
    emit,
  };
  timings.bundle = ms(t);
  emit({ type: 'bundle', hash: bundle.hash, chromium: ctx.chromium, ms: timings.bundle });

  // audio is independent of the pixels: start it now, collect it before the chunk render
  const audioJob = renderAudio({ spec, sheet, workDir: jobDir });
  audioJob.catch(() => {}); // awaited below

  try {
    // ── preflight: inputs, page QA, fingerprints → chunk keys ──
    t = performance.now();
    const qa: GateResult[] = [];
    const inputs = new Map<FormatId, ReelInput>();
    for (const f of spec.formats) inputs.set(f, await reelInput({ spec, sheet, formatId: f, specDir, bundle, styles }));
    const warnings = styles.diagnostics.filter((d) => d.level === 'warn');
    const styleGate: GateResult = {
      gate: 'style',
      level: warnings.length ? 'warn' : 'pass',
      detail: warnings.length
        ? warnings.map((d) => d.message).join('; ')
        : `${styles.scenes.length} scene layer(s), traits ${usedTraits(styles).map((t) => `${t.axis}:${t.id}`).join(' ')}`,
      data: styles.diagnostics,
    };
    const inUse = new Map<string, { palette: ResolvedPalette; sections: string[] }>();
    for (const [id, st] of Object.entries(styles.sections)) {
      const k = JSON.stringify(st.palette);
      if (!inUse.has(k)) inUse.set(k, { palette: st.palette, sections: [] });
      inUse.get(k)!.sections.push(id);
    }
    const contrastGate = gateContrast([...inUse.values()]);
    for (const g of [styleGate, contrastGate]) {
      qa.push(g);
      emit({ type: 'qa', phase: 'preflight', result: g });
    }
    const plans = await Promise.all(spec.formats.map((f) => preflight(ctx, probeBrowser, inputs.get(f)!)));
    await probeBrowser.close();
    for (const p of plans) {
      qa.push(...p.gates);
      for (const g of p.gates) emit({ type: 'qa', phase: 'preflight', result: g });
    }
    timings.preflight = ms(t);
    await failOnQa(qa, outDir);

    // ── audio ──
    const audio = await audioJob;
    timings.audio = Math.round(audio.ms);
    emit({
      type: 'audio',
      source: music.source === 'preset' ? `${music.preset} seed ${music.seed}` : music.source,
      duration: audio.samples / audio.sampleRate,
      ...(audio.wav ? { notes: audio.wav.notes, sha256: audio.wav.sha256 } : {}),
      ...(audio.loudness ? { lufs: audio.loudness.i, tp: audio.loudness.tp } : {}),
      ...(audio.normalization ? { normalization: audio.normalization } : {}),
      ms: audio.ms,
    });

    // ── chunks ──
    t = performance.now();
    for (const p of plans) {
      emit({
        type: 'plan',
        format: p.input.format.id,
        chunks: p.chunks.map((c) => ({ index: c.index, frames: c.f1 - c.f0, cached: c.cached })),
      });
    }
    const tasks: ChunkTask[] = plans.flatMap((p) =>
      p.chunks.filter((c) => !c.cached).map((c) => ({ format: p.input.format.id, chunk: c, key: c.key, input: p.input })),
    );
    const byTask = new Map(tasks.map((task) => [task, plans.find((p) => p.input.format.id === task.format)!.chunks[task.chunk.index]!]));
    await renderChunks(tasks, {
      workers: opts.workers ?? 4,
      origin: ctx.origin,
      entry: bundle.entry,
      quality: q,
      onProgress: (task, done) =>
        emit({ type: 'chunk', format: task.format, index: task.chunk.index, done, total: task.chunk.f1 - task.chunk.f0 }),
      onDone: (task, took) => {
        byTask.get(task)!.ms = Math.round(took);
        emit({ type: 'chunk-done', format: task.format, index: task.chunk.index, ms: took });
      },
    });
    timings.render = ms(t);
    emit({ type: 'rendered', rendered: tasks.length, cached: plans.reduce((n, p) => n + p.chunks.length, 0) - tasks.length, ms: timings.render });

    // ── assemble + post QA ──
    t = performance.now();
    const endcard = sheet.sections.find((s) => s.role === 'endcard') ?? sheet.sections.at(-1)!;
    const formats: Receipt['formats'] = {};
    const post: GateResult[] = [];
    const postEmit = (g: GateResult) => {
      post.push(g);
      emit({ type: 'qa', phase: 'post', result: g });
    };
    // formats assemble + probe in parallel; events go out in format order
    const assembled = await Promise.all(
      plans.map(async (p) => {
        const f = p.input.format;
        const a0 = performance.now();
        const exported = await assemble({
          jobId: spec.id,
          format: f.id,
          chunks: p.chunks.map((c) => chunkPath(c.key)),
          aac: audio.aac,
          outDir,
          workDir: jobDir,
          noMusic: spec.outputs.noMusic,
          thumbAt: endcard.timing.holdStart,
        });
        const took = performance.now() - a0;
        if (spec.outputs.keepChunks) {
          await mkdir(join(outDir, 'chunks'), { recursive: true });
          for (const c of p.chunks) await copyFile(chunkPath(c.key), join(outDir, 'chunks', `${formatSlug(f.id)}-${c.index + 1}.mp4`));
        }
        const want = { format: f.id, w: f.w, h: f.h, fps: q.fps, frames: sheet.frames };
        const [main, silent] = await Promise.all([
          probe(exported.video.path),
          exported.noMusic ? probe(exported.noMusic.path) : null,
        ]);
        const gates = [gateContainer(main, { ...want, audio: true, label: 'mp4' })];
        if (silent) gates.push(gateContainer(silent, { ...want, audio: false, label: 'no-music' }));
        return { p, exported, took, main, gates };
      }),
    );
    for (const a of assembled) {
      emit({ type: 'export', exported: a.exported, ms: a.took });
      a.gates.forEach(postEmit);
      formats[a.p.input.format.id] = { chunks: a.p.chunks, outputs: a.exported, probe: a.main };
    }
    postEmit(
      gateAudio(
        {
          ...(audio.wav ? { wavSamples: audio.wav.samples } : {}),
          sampleRate: audio.sampleRate,
          // the AAC stream as delivered inside the first export
          aacDuration: assembled[0]!.main.audioDuration ?? 0,
        },
        sheet,
      ),
    );
    if (audio.loudness) postEmit(gateLoudness(audio.loudness));
    qa.push(...post);
    timings.assemble = ms(t);
    await failOnQa(qa, outDir);

    // ── receipt + cleanup ──
    timings.total = ms(start);
    const receipt: Receipt = {
      job: spec.id,
      spec: { path: absSpec, sha256: sha256(loaded.bytes) },
      style: styleId,
      styles: { sections: styles.sections, scenes: styles.scenes, diagnostics: styles.diagnostics },
      quality: q,
      bpm,
      duration: sheet.duration,
      frames: sheet.frames,
      bundle: { hash: bundle.hash },
      chromium: ctx.chromium,
      ffmpeg: (await exec('ffmpeg', ['-version'])).stdout.split('\n')[0] ?? '',
      audio: audioReceipt(music.source, audio, await readFile(audio.aac)),
      formats,
      qa,
      timings,
      outDir,
    };
    const receiptPath = join(outDir, 'receipt.json');
    await writeAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    await rm(jobDir, { recursive: true, force: true });
    emit({ type: 'done', receipt: receiptPath, outDir, ms: timings.total });
    return receipt;
  } finally {
    await probeBrowser.close().catch(() => {});
    await server.close();
  }
}

interface Ctx {
  spec: JobSpec;
  sheet: CueSheet;
  q: QualitySettings;
  bundle: Bundle;
  origin: string;
  chromium: string;
  cache: boolean;
  emit: (e: RenderEvent) => void;
}

interface FormatPlan {
  input: ReelInput;
  gates: GateResult[];
  chunks: ChunkRecord[];
}

/** One format: page QA at every hold, determinism, then a fingerprint per chunk → cache keys and hits. */
async function preflight(ctx: Ctx, browser: Browser, input: ReelInput): Promise<FormatPlan> {
  const tab = await ReelTab.open(browser, { origin: ctx.origin, entry: ctx.bundle.entry, input });
  try {
    const samples = await sampleHolds(tab, ctx.sheet);
    const gates: GateResult[] = [gateBounds(samples, input), gateFidelity(samples, input), gateOverlap(samples, input)];
    const weekday = gateWeekday(samples, ctx.spec, input);
    if (weekday) gates.push(weekday);
    gates.push(await gateDeterminism(tab, { origin: ctx.origin, entry: ctx.bundle.entry, input, sheet: ctx.sheet }));

    const chunks: ChunkRecord[] = [];
    for (const c of planChunks(ctx.sheet.frames, ctx.q.fps)) {
      const [t0, t1] = chunkWindow(c, ctx.q);
      const key = chunkKey({
        bundleHash: ctx.bundle.hash,
        chromium: ctx.chromium,
        format: input.format,
        quality: ctx.q,
        chunk: c,
        fingerprint: await tab.fingerprint(t0, t1),
        look: { palette: input.palette, fonts: input.fonts, params: input.params },
      });
      const cached = ctx.cache && (await stat(chunkPath(key)).then((s) => s.size > 0, () => false));
      chunks.push({ ...c, key, cached });
    }
    await tab.check();
    return { input, gates, chunks };
  } finally {
    await tab.close();
  }
}

async function failOnQa(qa: GateResult[], outDir: string): Promise<void> {
  const qaPath = join(outDir, 'qa.json');
  await writeAtomic(qaPath, JSON.stringify(qa, null, 2) + '\n');
  if (qa.some((r) => r.level === 'fail')) throw new QaError(qa, qaPath);
}

function audioReceipt(source: string, a: AudioResult, aac: Buffer): Receipt['audio'] {
  return {
    source,
    aacSha256: sha256(aac),
    ...(a.wav ? { wavSha256: a.wav.sha256, notes: a.wav.notes } : {}),
    ...(a.loudness ? { lufs: a.loudness.i, tp: a.loudness.tp } : {}),
    ...(a.normalization ? { normalization: a.normalization } : {}),
  };
}
