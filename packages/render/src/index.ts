/**
 * `renderJob`: spec → music source → grid → cue sheet (+ envelopes) → bundle → preflight QA (+ the page's sound
 * cues → SFX stem) → chunk render (cached) ∥ mix/master/loudnorm → assemble → post QA (PLAN.md §8). Emits typed
 * events for the CLI; returns the receipt that is also written next to the outputs.
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
  type SoundCue,
  type SoundKind,
} from '@reel/core';
import { renderSfx } from '@reel/audio';
import { RECIPES, recipe } from '@reel/styles';
import { formatDiagnostics, resolveStyles, TRAIT_META, usedTraits, type StyleResolution } from '@reel/traits';
import { assemble, type Exported } from './assemble.ts';
import { finishAudio, prepareMusic, SAMPLE_RATE, type AudioResult, type MusicInfo } from './audio.ts';
import { buildBundle, specFontIds, type Bundle } from './bundle.ts';
import { resolveFonts } from './fonts.ts';
import type { Browser } from 'playwright';
import { launchBrowser, ReelTab } from './capture.ts';
import { cacheBudgetBytes, pruneCaches, touch } from './cache.ts';
import { chunkKey, chunkPath, chunkWindow, planChunks, renderChunks, WORKERS, type ChunkPlan, type ChunkTask } from './chunks.ts';
import { resolveQuality, type Preset, type QualitySettings } from './encode.ts';
import {
  gateAudio,
  gateAudioSync,
  gateBounds,
  gateContainer,
  gateContrast,
  gateDeterminism,
  gateFidelity,
  gateGlyphs,
  gateLoudness,
  gateOverlap,
  gateSketches,
  gateSfx,
  gateWeekday,
  probe,
  sampleHolds,
  type GateResult,
  type ProbeSummary,
} from './qa.ts';
import { checkSamples, nodeSampleBank } from './samples.ts';
import { reelInput } from './reel-input.ts';
import { serveDir } from './server.ts';
import { exec, REPO, sha256, writeAtomic } from './util.ts';

export { ensureFonts, findFontFile, FONT_DIR, missingChars, readFont, resolveFonts } from './fonts.ts';
export type { FontInfo, SpecFont } from './fonts.ts';
export { checkSamples, setupSamples, nodeSampleBank, SetupError, SAMPLE_DIR } from './samples.ts';
export { cacheBudgetBytes, cacheUsage, CACHE_DIRS, DEFAULT_CACHE_MB, pruneCaches, touch } from './cache.ts';
export type { CacheUsage, PruneResult } from './cache.ts';
export { setupAnalysis, analyzeTrack, ANALYSIS_DIR, MODEL_PATH } from './analysis.ts';
export { ACE_MODEL_DIR, aiClip, cachedMusicAi, generateMusicAi, MUSIC_AI_CACHE, musicAiInstalled, musicAiKey, musicAiReady, setupMusicAi } from './music-ai.ts';
export type { MusicAiRequest, MusicAiResult } from './music-ai.ts';
export { prepareMusic, finishAudio, mixStems, stereoSha, SAMPLE_RATE } from './audio.ts';
export type { MusicInfo, MusicStage, AudioResult } from './audio.ts';
export { fontCodepoints, gateGlyphs, specText } from './qa.ts';
export type { GateResult, Level, ProbeSummary } from './qa.ts';
export type { Exported } from './assemble.ts';
export type { Preset, QualitySettings } from './encode.ts';
export { buildBundle, findLogo, specFontIds, type Bundle } from './bundle.ts';
export { imageSize, loadSketchDoc, logoColors, reelInput, specSketchAssets } from './reel-input.ts';
export { launchBrowser, ReelTab } from './capture.ts';
export type { Browser } from 'playwright';
export { CSP } from './server.ts';
export { resolveQuality } from './encode.ts';
export { REPO } from './util.ts';

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
  /** Temp directory of the job (bundle, audio); default `data/jobs/<job-id>`. Removed when the job ends. */
  workDir?: string;
  /** Stop after the preflight QA gates: no video, no audio, no outputs; resolves to the gates instead of a receipt. */
  preflightOnly?: boolean;
  /** Aborting stops the job at the next frame and rejects with `RenderCancelled`. */
  signal?: AbortSignal;
}

/** Result of a `preflightOnly` run. */
export interface Preflight {
  qa: GateResult[];
  ms: number;
}

/** The job's `signal` was aborted. */
export class RenderCancelled extends Error {
  constructor() {
    super('render cancelled');
    this.name = 'RenderCancelled';
  }
}

export type Phase = 'preflight' | 'post';

export type RenderEvent =
  | { type: 'spec'; job: string; sections: number; duration: number; bpm: number; fps: number; quality: string; formats: FormatId[] }
  | { type: 'bundle'; hash: string; chromium: string; ms: number }
  | { type: 'qa'; phase: Phase; result: GateResult }
  /** Music source after steps 1–3 (preset render, or track decode + analysis + grid). */
  | { type: 'music'; info: MusicInfo }
  /** AI music generation (cache miss only): sidecar progress 0..1 and its stage. */
  | { type: 'music-ai'; progress: number; stage: string }
  /** SFX stem from the page's sound cues (`enabled: false` when `spec.sfx` is off). */
  | { type: 'sfx'; enabled: boolean; count: number; byKind: Partial<Record<SoundKind, number>>; ms: number }
  | {
      type: 'audio';
      duration: number;
      /** Mastered mix hash (`stereoSha`; absent for silence). */
      sha256?: string;
      lufs?: number;
      tp?: number;
      normalization?: string;
      /** What the `-no-music` copies carry. */
      noMusic: 'sfx' | 'silent' | 'off';
      ms: number;
    }
  | { type: 'plan'; format: FormatId; chunks: { index: number; frames: number; cached: boolean }[] }
  | { type: 'chunk'; format: FormatId; index: number; done: number; total: number }
  | { type: 'chunk-done'; format: FormatId; index: number; ms: number }
  | { type: 'rendered'; rendered: number; cached: number; ms: number }
  | { type: 'export'; exported: Exported; ms: number }
  /** LRU pruning of all caches after the job (`REEL_CACHE_MB` budget). */
  | { type: 'cache'; freed: number; removed: number; left: number; budget: number }
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
  audio: {
    /** `preset lofi-jazz seed 1101`, `track it-had-to-be-you +12.3 s`, `ai seed 7 +0 s` or `none`. */
    source: string;
    /** `stereoSha` of the music stem, the SFX stem and the mastered mix. */
    music?: string;
    sfx?: string;
    mix?: string;
    wavSha256?: string;
    aacSha256: string;
    noMusicAacSha256?: string;
    notes?: number;
    lufs?: number;
    tp?: number;
    normalization?: string;
    gainDb?: number;
    track?: { file: string; path: string; sha256: string; offset: number; fadeOut: number; covered: number };
    /** AI music: the prompt, the cached clip and how it was obtained. */
    ai?: { prompt: string; lyrics: boolean; seed: number; bpmHint: number | null; key: string; path: string; sha256: string; seconds: number; cached: boolean; generateMs: number; offset: number; fadeOut: number; covered: number };
    grid?: {
      bpm: number;
      beats: number;
      downbeats: number;
      meter: number | null;
      meterConfidence: number | null;
      downbeatsUsed: boolean;
      trimmed: { head: number; tail: number };
      analysis: { cached: boolean; model: string; path: string };
    };
    sfxCues?: { count: number; byKind: Partial<Record<SoundKind, number>> };
  };
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

export function renderJob(specPath: string, opts: RenderOptions & { preflightOnly: true }, emit: (e: RenderEvent) => void): Promise<Preflight>;
export function renderJob(specPath: string, opts: RenderOptions & { preflightOnly?: false }, emit: (e: RenderEvent) => void): Promise<Receipt>;
export function renderJob(specPath: string, opts: RenderOptions, emit: (e: RenderEvent) => void): Promise<Receipt | Preflight> {
  return renderJobWith(specPath, opts, emit, buildBundle);
}

/** `renderJob` with the bundle step swapped out: the fixture-page tests render through the real pipeline. */
export function renderJobWith(
  specPath: string,
  opts: RenderOptions & { preflightOnly?: false },
  emit: (e: RenderEvent) => void,
  makeBundle: typeof buildBundle,
): Promise<Receipt>;
export function renderJobWith(
  specPath: string,
  opts: RenderOptions,
  emit: (e: RenderEvent) => void,
  makeBundle: typeof buildBundle,
): Promise<Receipt | Preflight>;
export async function renderJobWith(
  specPath: string,
  opts: RenderOptions,
  emit: (e: RenderEvent) => void,
  makeBundle: typeof buildBundle,
): Promise<Receipt | Preflight> {
  const cancelled = () => {
    if (opts.signal?.aborted) throw new RenderCancelled();
  };
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
  const q = resolveQuality(spec.quality);

  // ── render order 1–3: music source → grid → cue sheet + envelopes ──
  let t = performance.now();
  if (music.source === 'preset' || spec.sfx) await checkSamples();
  const samples = nodeSampleBank();
  const stage = await prepareMusic({
    spec,
    specDir,
    choreography: rec.choreography,
    fps: q.fps,
    samples,
    defaultBpm: rec.defaults.music.bpm,
    onProgress: (progress, stage) => emit({ type: 'music-ai', progress, stage }),
  });
  timings.music = ms(t);
  const { sheet } = stage;
  const bpm = sheet.bpm!;
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
  emit({ type: 'music', info: stage.info });

  const jobDir = resolve(opts.workDir ?? join(JOBS_DIR, spec.id));
  const outDir = join(resolve(opts.outDir ?? OUT_DIR), spec.id);
  await mkdir(jobDir, { recursive: true });
  if (!opts.preflightOnly) await mkdir(outDir, { recursive: true });
  cancelled();

  // ── bundle + browsers ──
  t = performance.now();
  const bundle = await makeBundle({ spec, specDir, outDir: join(jobDir, 'bundle'), traits: usedTraits(styles) });
  const server = await serveDir(bundle.dir);
  // CPU raster: the probe's forward/reverse purity check must not see the GPU glyph atlas' history (capture.ts)
  const probeBrowser = await launchBrowser({ raster: 'cpu' });
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
    // glyph coverage first: a page with tofu can hang in `ready()` (troika's CDN fallback)
    const fonts = Object.values(await resolveFonts(specFontIds(spec), specDir));
    for (const g of [styleGate, contrastGate, await gateGlyphs(spec, fonts)]) {
      qa.push(g);
      emit({ type: 'qa', phase: 'preflight', result: g });
    }
    if (opts.preflightOnly && qa.some((g) => g.level === 'fail')) return { qa, ms: ms(start) };
    if (!opts.preflightOnly) await failOnQa(qa, outDir);
    cancelled();
    const plans = await Promise.all(spec.formats.map((f) => preflight(ctx, probeBrowser, inputs.get(f)!)));
    await probeBrowser.close();
    for (const p of plans) {
      qa.push(...p.gates);
      for (const g of p.gates) emit({ type: 'qa', phase: 'preflight', result: g });
    }
    timings.preflight = ms(t);
    if (opts.preflightOnly) return { qa, ms: ms(start) };
    await failOnQa(qa, outDir);
    cancelled();

    // ── render order 4: the page's sound cues (first format; cues are a pure function of REEL) → SFX stem ──
    t = performance.now();
    const cues: SoundCue[] = spec.sfx ? plans[0]!.soundCues : [];
    const byKind: Partial<Record<SoundKind, number>> = {};
    for (const c of cues) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    const sfxStem = spec.sfx
      ? renderSfx(cues, {
          duration: sheet.frames / sheet.fps,
          seed: music.source === 'preset' ? music.seed : 0,
          samples,
          sampleRate: SAMPLE_RATE,
        })
      : null;
    timings.sfx = ms(t);
    emit({ type: 'sfx', enabled: spec.sfx, count: cues.length, byKind, ms: timings.sfx });

    // ── render order 5: mix → master → WAV → loudnorm/AAC, while the chunks render ──
    const noMusicSfx = spec.sfx && spec.outputs.noMusic && sfxStem !== null;
    const audioJob = finishAudio({ music: stage.music, sfx: sfxStem, noMusicSfx, frames: sheet.frames, fps: sheet.fps, workDir: jobDir });
    audioJob.catch(() => {}); // awaited after the chunk render

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
      workers: opts.workers ?? WORKERS,
      origin: ctx.origin,
      entry: bundle.entry,
      quality: q,
      onProgress: (task, done) => {
        cancelled();
        emit({ type: 'chunk', format: task.format, index: task.chunk.index, done, total: task.chunk.f1 - task.chunk.f0 });
      },
      onDone: (task, took) => {
        byTask.get(task)!.ms = Math.round(took);
        emit({ type: 'chunk-done', format: task.format, index: task.chunk.index, ms: took });
      },
    }).catch((e: unknown) => {
      cancelled();
      throw e;
    });
    cancelled();
    timings.render = ms(t);
    emit({ type: 'rendered', rendered: tasks.length, cached: plans.reduce((n, p) => n + p.chunks.length, 0) - tasks.length, ms: timings.render });

    const audio = await audioJob;
    timings.audio = Math.round(audio.ms);
    emit({
      type: 'audio',
      duration: audio.samples / audio.sampleRate,
      ...(audio.hashes.mix ? { sha256: audio.hashes.mix } : {}),
      ...(audio.loudness ? { lufs: audio.loudness.i, tp: audio.loudness.tp } : {}),
      ...(audio.normalization ? { normalization: audio.normalization } : {}),
      noMusic: !spec.outputs.noMusic ? 'off' : audio.noMusicAac ? 'sfx' : 'silent',
      ms: audio.ms,
    });

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
          ...(audio.noMusicAac ? { noMusicAac: audio.noMusicAac } : {}),
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
        if (silent) gates.push(gateContainer(silent, { ...want, audio: audio.noMusicAac !== undefined, label: 'no-music' }));
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
    if (stage.detectedBeats) postEmit(gateAudioSync(sheet, stage.detectedBeats));
    if (stage.music && sfxStem) postEmit(gateSfx(stage.music, sfxStem, cues));
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
      audio: {
        ...audioReceipt(stage.info, audio, await readFile(audio.aac)),
        ...(audio.noMusicAac ? { noMusicAacSha256: sha256(await readFile(audio.noMusicAac)) } : {}),
        ...(spec.sfx ? { sfxCues: { count: cues.length, byKind } } : {}),
      },
      formats,
      qa,
      timings,
      outDir,
    };
    const receiptPath = join(outDir, 'receipt.json');
    await writeAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    await rm(jobDir, { recursive: true, force: true });
    const pruned = await pruneCaches({ keep: plans.flatMap((p) => p.chunks.map((c) => chunkPath(c.key))) });
    emit({ type: 'cache', freed: pruned.freed, removed: pruned.removed, left: pruned.left, budget: cacheBudgetBytes() });
    emit({ type: 'done', receipt: receiptPath, outDir, ms: timings.total });
    return receipt;
  } finally {
    await probeBrowser.close().catch(() => {});
    await server.close();
    if (opts.preflightOnly) await rm(jobDir, { recursive: true, force: true });
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
  /** `reelPage.soundCues()` after `ready()`. */
  soundCues: SoundCue[];
}

/** One format: page QA at every hold, determinism, then a fingerprint per chunk → cache keys and hits. */
async function preflight(ctx: Ctx, browser: Browser, input: ReelInput): Promise<FormatPlan> {
  const tab = await ReelTab.open(browser, { origin: ctx.origin, entry: ctx.bundle.entry, input });
  try {
    const samples = await sampleHolds(tab, ctx.sheet);
    const gates: GateResult[] = [gateBounds(samples, input), gateFidelity(samples, input), gateOverlap(samples, input)];
    const sketch = gateSketches(samples, input);
    if (sketch) gates.push(sketch);
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
      if (cached) await touch(chunkPath(key));
      chunks.push({ ...c, key, cached });
    }
    const soundCues = await tab.soundCues();
    await tab.check();
    return { input, gates, chunks, soundCues };
  } finally {
    await tab.close();
  }
}

async function failOnQa(qa: GateResult[], outDir: string): Promise<void> {
  const qaPath = join(outDir, 'qa.json');
  await writeAtomic(qaPath, JSON.stringify(qa, null, 2) + '\n');
  if (qa.some((r) => r.level === 'fail')) throw new QaError(qa, qaPath);
}

function audioReceipt(info: MusicInfo, a: AudioResult, aac: Buffer): Receipt['audio'] {
  const source =
    info.source === 'preset'
      ? `preset ${info.preset} seed ${info.seed}`
      : info.source === 'track'
        ? `track ${info.file} +${info.offset} s`
        : info.source === 'ai'
          ? `ai seed ${info.seed} +${info.offset} s`
          : 'none';
  return {
    source,
    ...a.hashes,
    aacSha256: sha256(aac),
    ...(a.wav ? { wavSha256: a.wav.sha256 } : {}),
    ...(info.source === 'preset' ? { notes: info.notes } : {}),
    ...(a.loudness ? { lufs: a.loudness.i, tp: a.loudness.tp } : {}),
    ...(a.normalization ? { normalization: a.normalization } : {}),
    ...(a.gainDb !== undefined ? { gainDb: a.gainDb } : {}),
    ...(info.source === 'track' ? { track: { file: info.file, path: info.path, sha256: info.sha256, offset: info.offset, fadeOut: info.fadeOut, covered: info.covered } } : {}),
    ...(info.source === 'ai'
      ? {
          ai: {
            prompt: info.prompt,
            lyrics: info.lyrics,
            seed: info.seed,
            bpmHint: info.bpmHint,
            key: info.generation.key,
            path: info.path,
            sha256: info.sha256,
            seconds: info.generation.seconds,
            cached: info.generation.cached,
            generateMs: Math.round(info.generation.ms),
            offset: info.offset,
            fadeOut: info.fadeOut,
            covered: info.covered,
          },
        }
      : {}),
    ...(info.source === 'track' || info.source === 'ai'
      ? {
          grid: {
            bpm: info.bpm,
            beats: info.beats,
            downbeats: info.downbeats,
            meter: info.meter,
            meterConfidence: info.meterConfidence,
            downbeatsUsed: info.downbeatsUsed,
            trimmed: info.trimmed,
            analysis: { cached: info.analysis.cached, model: info.analysis.model, path: info.analysis.path },
          },
        }
      : {}),
  };
}
