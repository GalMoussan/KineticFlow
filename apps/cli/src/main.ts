#!/usr/bin/env node
/** `reelgen`: headless renders, the local web app, setup of local assets (fonts, samples, analysis) and cache cleanup (PLAN.md §8.5). */
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FONTS, FormatId } from '@reel/core';
import {
  cacheBudgetBytes,
  cacheUsage,
  CACHE_DIRS,
  DATA_DIR,
  JOBS_DIR,
  OUT_DIR,
  ensureFonts,
  pruneCaches,
  renderJob,
  setupAnalysis,
  setupSamples,
  type Preset,
} from '@reel/render';
import { serveApp } from '@reel/server';
import { dim, green, mb, red, rel, renderPrinter, secs } from '@reel/server/term';

const HELP = `reelgen — render kinetic-typography reels from a job spec

Usage:
  reelgen render <job.json> [--quality draft|standard|final] [--formats 9:16,1:1]
                            [--workers N] [--no-cache] [--out dir]
  reelgen serve [--port N] [--dev] [--no-open]
                            the local web app on http://127.0.0.1:<port> (default 5173, or the next free port);
                            builds apps/web first when its dist/ is missing or older than its sources
                              --dev      Vite dev server with hot reload on 5173 (proxying /api, /files and
                                         /preview to the API server on 5180+) instead of the built app
                              --no-open  do not open the browser
  reelgen setup [fonts|samples|analysis]
                            install local assets (no argument: all three)
                              fonts     catalog fonts → assets/fonts/ (SHA-256 checked)
                              samples   CC0 audio samples → assets/samples/ (SHA-256 checked)
                              analysis  beat-tracking sidecar (uv sync in sidecar/, ~720 MB) and the
                                        Beat This! final0 model → assets/models/ (81 MB, SHA-256 checked)
  reelgen clean [--cache] [--outputs <days>]
                            delete temp files (data/jobs, data/checks) and prune the caches (rendered
                            chunks, preview audio/bundles, style stills) to the REEL_CACHE_MB budget
                            (default 2048), least recently used first
                              --cache    empty every cache instead
                              --outputs  also delete output folders in out/ untouched for <days> days
  reelgen --help

render options:
  --quality   override the spec's quality preset
  --formats   comma-separated subset/override of the spec's formats
  --workers   parallel browsers (default 8)
  --no-cache  re-render every chunk (fresh results still refresh the cache)
  --out       output root (default out/); files go to <out>/<job-id>/
`;

const cwd = process.env.INIT_CWD ?? process.cwd();

class UsageError extends Error {}

async function render(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      quality: { type: 'string' },
      formats: { type: 'string' },
      workers: { type: 'string' },
      'no-cache': { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  const [specArg, ...extra] = positionals;
  if (!specArg || extra.length) throw new UsageError('render needs exactly one <job.json>');
  if (values.quality && !['draft', 'standard', 'final'].includes(values.quality)) {
    throw new UsageError(`--quality must be draft, standard or final (got "${values.quality}")`);
  }
  const formats = values.formats?.split(',').map((f) => {
    const parsed = FormatId.safeParse(f.trim());
    if (!parsed.success) throw new UsageError(`unknown format "${f}" (known: ${FormatId.options.join(', ')})`);
    return parsed.data;
  });
  const workers = values.workers === undefined ? undefined : Number(values.workers);
  if (workers !== undefined && !(Number.isInteger(workers) && workers >= 1 && workers <= 16)) {
    throw new UsageError(`--workers must be an integer from 1 to 16 (got "${values.workers}")`);
  }

  const printer = renderPrinter();

  const specPath = resolve(cwd, specArg);
  try {
    await renderJob(
      specPath,
      {
        ...(values.quality ? { quality: values.quality as Preset } : {}),
        ...(formats ? { formats } : {}),
        ...(workers ? { workers } : {}),
        ...(values.out ? { outDir: resolve(cwd, values.out) } : {}),
        cache: !values['no-cache'],
      },
      printer.emit,
    );
  } catch (e) {
    printer.freeze();
    throw e;
  }
}

async function dirSize(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { recursive: true, withFileTypes: true });
    let total = 0;
    for (const e of entries) if (e.isFile()) total += (await stat(join(e.parentPath, e.name))).size;
    return total;
  } catch {
    return 0;
  }
}

async function newestMtime(path: string): Promise<number> {
  let t = (await stat(path)).mtimeMs;
  for (const e of await readdir(path, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) t = Math.max(t, (await stat(join(e.parentPath, e.name))).mtimeMs);
  }
  return t;
}

async function clean(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { cache: { type: 'boolean', default: false }, outputs: { type: 'string' } },
  });
  const days = values.outputs === undefined ? undefined : Number(values.outputs);
  if (days !== undefined && !(Number.isFinite(days) && days >= 0)) {
    throw new UsageError(`--outputs needs a number of days (got "${values.outputs}")`);
  }
  for (const dir of [JOBS_DIR, join(DATA_DIR, 'checks'), join(DATA_DIR, 'fixture-out')]) {
    const bytes = await dirSize(dir);
    await rm(dir, { recursive: true, force: true });
    if (bytes) console.log(`removed ${rel(dir)} (${mb(bytes)})`);
  }
  if (values.cache) {
    for (const dir of CACHE_DIRS) {
      const bytes = await dirSize(dir);
      await rm(dir, { recursive: true, force: true });
      console.log(`removed ${rel(dir)} (${mb(bytes)})`);
    }
  } else {
    const p = await pruneCaches({ minAgeMs: 0 });
    console.log(
      `cache ${mb(p.left)} of ${mb(cacheBudgetBytes())} budget (REEL_CACHE_MB)` +
        (p.removed ? ` · pruned ${p.removed} least recently used entries (${mb(p.freed)})` : ''),
    );
    for (const [dir, bytes] of Object.entries((await cacheUsage()).byDir)) console.log(dim(`  ${rel(dir).padEnd(22)} ${mb(bytes)}`));
    console.log(dim('use --cache to empty every cache'));
  }
  if (days !== undefined) {
    const cutoff = Date.now() - days * 86_400_000;
    let n = 0;
    let freed = 0;
    for (const e of await readdir(OUT_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const dir = join(OUT_DIR, e.name);
      if ((await newestMtime(dir)) > cutoff) continue;
      freed += await dirSize(dir);
      await rm(dir, { recursive: true, force: true });
      n++;
    }
    console.log(`removed ${n} output folder(s) in ${rel(OUT_DIR)} older than ${days} day(s) (${mb(freed)})`);
  }
}

const SETUP_TARGETS = ['fonts', 'samples', 'analysis'] as const;

async function setup(args: string[]): Promise<void> {
  const targets = args.length ? args : [...SETUP_TARGETS];
  for (const t of targets) {
    if (!(SETUP_TARGETS as readonly string[]).includes(t)) {
      throw new UsageError(`unknown setup target "${t}" (known: ${SETUP_TARGETS.join(', ')})`);
    }
  }
  const log = (msg: string) => console.log(msg);
  for (const t of targets) {
    const t0 = performance.now();
    if (t === 'fonts') {
      const paths = await ensureFonts(Object.keys(FONTS), log);
      for (const [id, path] of Object.entries(paths)) console.log(`${green('✓')} ${id.padEnd(18)} ${rel(path)}`);
    } else if (t === 'samples') await setupSamples(log);
    else await setupAnalysis(log);
    console.log(`${green('✓')} setup ${t} ${dim(secs(performance.now() - t0))}`);
  }
}

async function serve(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string' },
      dev: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
    },
  });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new UsageError(`--port must be a TCP port number (got "${values.port}")`);
  }
  await serveApp({ ...(port ? { port } : {}), dev: values.dev, open: !values['no-open'] });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'render':
        await render(rest);
        return 0;
      case 'setup':
        await setup(rest);
        return 0;
      case 'clean':
        await clean(rest);
        return 0;
      case 'serve':
        await serve(rest);
        return 0;
      case undefined:
      case '-h':
      case '--help':
      case 'help':
        process.stdout.write(HELP);
        return cmd === undefined ? 1 : 0;
      default:
        throw new UsageError(`unknown command "${cmd}"`);
    }
  } catch (e) {
    const err = e as Error;
    const parseError = 'code' in err && typeof err.code === 'string' && err.code.startsWith('ERR_PARSE_ARGS');
    if (err instanceof UsageError || parseError) {
      process.stderr.write(`${red('error:')} ${err.message}\n\n${HELP}`);
      return 2;
    }
    // TimingError / SpecError / QaError carry user-facing messages; anything else also shows its cause chain
    const known = ['TimingError', 'SpecError', 'QaError', 'SetupError'].includes(err.name);
    process.stderr.write(`${red('✗')} ${err.message}\n`);
    if (!known && err.stack && process.env.REELGEN_DEBUG) process.stderr.write(dim(err.stack) + '\n');
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
