#!/usr/bin/env node
/** `reelgen`: headless renders, font setup and cache cleanup (PLAN.md §8.5). */
import { readdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FONTS, FormatId } from '@reel/core';
import {
  CHUNK_DIR,
  DATA_DIR,
  JOBS_DIR,
  ensureFonts,
  renderJob,
  type GateResult,
  type Preset,
  type RenderEvent,
} from '@reel/render';

const HELP = `reelgen — render kinetic-typography reels from a job spec

Usage:
  reelgen render <job.json> [--quality draft|standard|final] [--formats 9:16,1:1]
                            [--workers N] [--no-cache] [--out dir]
  reelgen setup fonts       download and verify every catalog font into assets/fonts/
  reelgen clean [--cache]   delete job temp files (data/jobs); --cache also empties the chunk cache
  reelgen --help

render options:
  --quality   override the spec's quality preset
  --formats   comma-separated subset/override of the spec's formats
  --workers   parallel browsers (default 4)
  --no-cache  re-render every chunk (fresh results still refresh the cache)
  --out       output root (default out/); files go to <out>/<job-id>/
`;

const tty = process.stdout.isTTY === true;
const color = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = color('2');
const green = color('32');
const yellow = color('33');
const red = color('31');
const cwd = process.env.INIT_CWD ?? process.cwd();
const rel = (p: string) => {
  const r = relative(cwd, p);
  return r.startsWith('..') ? p : r;
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const MARK = { pass: green('✓'), warn: yellow('⚠'), fail: red('✗') } as const;

class UsageError extends Error {}

/** Permanent lines scroll above a live block of progress lines that is redrawn in place (TTY only). */
class Screen {
  readonly #prefix: string;
  #live: string[] = [];
  #drawn = 0;
  constructor(prefix: string) {
    this.#prefix = prefix;
  }
  line(text: string, stream: NodeJS.WriteStream = process.stdout) {
    this.#clear();
    stream.write(`${this.#prefix} ${text}\n`);
    this.#draw();
  }
  live(lines: string[]) {
    this.#clear();
    this.#live = lines;
    this.#draw();
  }
  /** Leaves the current live block on screen as permanent output. */
  freeze() {
    this.#live = [];
    this.#drawn = 0;
  }
  #clear() {
    if (!tty || !this.#drawn) return;
    process.stdout.write(`\x1b[${this.#drawn}A\x1b[0J`);
    this.#drawn = 0;
  }
  #draw() {
    if (!tty || !this.#live.length) return;
    const lines = this.#live.map((l) => `${this.#prefix} ${l}`);
    process.stdout.write(lines.map((l) => `${l}\n`).join(''));
    // rows actually used, so narrow terminals that wrap a progress line still redraw in place
    const cols = process.stdout.columns || 80;
    this.#drawn = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.replace(/\x1b\[[0-9;]*m/g, '').length / cols)), 0);
  }
}

interface ChunkState {
  frames: number;
  done: number;
  cached: boolean;
  finished: boolean;
  ms?: number;
}

function bar(done: number, total: number, width = 10): string {
  const full = Math.round((done / total) * width);
  return '█'.repeat(full) + '░'.repeat(width - full);
}

function gateLine(phase: string, g: GateResult): string {
  const detail = g.detail.length > 200 ? `${g.detail.slice(0, 197)}…` : g.detail;
  return `QA ${MARK[g.level]} ${g.gate}${g.format ? ` ${g.format}` : ''} ${dim(`(${phase})`)} ${g.level === 'pass' ? dim(detail) : detail}`;
}

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

  let screen = new Screen(dim('[reelgen]'));
  const progress = new Map<FormatId, ChunkState[]>();
  let lastPlain = 0;
  let lastDraw = 0;
  const progressLine = (f: FormatId, chunks: ChunkState[]) => {
    const parts = chunks.map((c, i) => {
      const name = `chunk ${i + 1}/${chunks.length}`;
      if (c.cached) return `${name} cached ${green('✓')}`;
      if (c.finished) return `${name} ${green('✓')} ${dim(secs(c.ms ?? 0))}`;
      return `${name} ${bar(c.done, c.frames)} ${c.done}/${c.frames}`;
    });
    return `${f.padEnd(4)} ${parts.join('   ')}`;
  };
  const progressLines = () => [...progress].map(([f, chunks]) => progressLine(f, chunks));
  /** TTY: redraw the live block (≤ 12/s). Plain: one line for a format whose chunk just finished, all every 5 s. */
  const showProgress = (force: boolean, format?: FormatId) => {
    const now = performance.now();
    if (tty) {
      if (!force && now - lastDraw < 80) return;
      lastDraw = now;
      screen.live(progressLines());
    } else if (format && force) {
      screen.line(progressLine(format, progress.get(format)!));
    } else if (now - lastPlain > 5000) {
      lastPlain = now;
      for (const l of progressLines()) screen.line(l);
    }
  };

  const emit = (e: RenderEvent) => {
    switch (e.type) {
      case 'spec':
        screen = new Screen(dim(`[${e.job}]`));
        screen.line(
          `spec ok · ${e.sections} sections · ${e.duration.toFixed(1)} s · ${e.bpm} bpm · formats ${e.formats.join(',')} · ${e.quality} (${e.fps} fps)`,
        );
        break;
      case 'bundle':
        screen.line(`bundle ${green('✓')} ${e.hash.slice(0, 12)}… · chromium ${e.chromium} ${dim(secs(e.ms))}`);
        break;
      case 'qa':
        screen.line(gateLine(e.phase, e.result), e.result.level === 'fail' ? process.stderr : process.stdout);
        break;
      case 'audio':
        screen.line(
          e.source === 'none'
            ? `audio ${green('✓')} silence (${e.duration.toFixed(3)} s)`
            : `score ${green('✓')} ${e.source} · ${e.sha256?.slice(0, 12)}… (${e.duration.toFixed(3)} s, ${e.notes} notes) → AAC 256k · ` +
                `${e.lufs?.toFixed(1)} LUFS · TP ${e.tp?.toFixed(1)} dBTP · ${e.normalization ?? ''} loudnorm ${dim(secs(e.ms))}`,
        );
        break;
      case 'plan':
        progress.set(
          e.format,
          e.chunks.map((c) => ({ frames: c.frames, done: c.cached ? c.frames : 0, cached: c.cached, finished: c.cached })),
        );
        lastPlain = performance.now();
        showProgress(true);
        break;
      case 'chunk': {
        const c = progress.get(e.format)?.[e.index];
        if (c) c.done = e.done;
        showProgress(false);
        break;
      }
      case 'chunk-done': {
        const c = progress.get(e.format)?.[e.index];
        if (c) Object.assign(c, { finished: true, done: c.frames, ms: e.ms });
        showProgress(true, e.format);
        break;
      }
      case 'rendered':
        if (tty) {
          screen.live(progressLines());
          screen.freeze();
        } else for (const l of progressLines()) screen.line(l);
        screen.line(`render ${green('✓')} ${e.rendered} chunk(s) rendered, ${e.cached} cached ${dim(secs(e.ms))}`);
        break;
      case 'export': {
        const x = e.exported;
        screen.line(
          `export ${green('✓')} ${rel(x.video.path)} (${mb(x.video.bytes)})` +
            (x.noMusic ? ` + -no-music (${mb(x.noMusic.bytes)})` : '') +
            ` + thumbnail ${dim(secs(e.ms))}`,
        );
        break;
      }
      case 'done':
        screen.line(`done ${green('✓')} ${secs(e.ms)} · ${rel(e.receipt)}`);
        break;
    }
  };

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
      emit,
    );
  } catch (e) {
    screen.freeze();
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

async function clean(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { cache: { type: 'boolean', default: false } } });
  const targets = [JOBS_DIR, join(DATA_DIR, 'fixture-out'), ...(values.cache ? [CHUNK_DIR] : [])];
  for (const dir of targets) {
    const bytes = await dirSize(dir);
    await rm(dir, { recursive: true, force: true });
    console.log(`removed ${rel(dir)} (${mb(bytes)})`);
  }
  if (!values.cache) console.log(dim(`chunk cache kept: ${rel(CHUNK_DIR)} (${mb(await dirSize(CHUNK_DIR))}); use --cache to empty it`));
}

async function setup(args: string[]): Promise<void> {
  if (args[0] !== 'fonts' || args.length > 1) throw new UsageError('usage: reelgen setup fonts');
  const paths = await ensureFonts(Object.keys(FONTS), (msg) => console.log(msg));
  for (const [id, path] of Object.entries(paths)) console.log(`${green('✓')} ${id.padEnd(18)} ${rel(path)}`);
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
    const known = ['TimingError', 'SpecError', 'QaError'].includes(err.name);
    process.stderr.write(`${red('✗')} ${err.message}\n`);
    if (!known && err.stack && process.env.REELGEN_DEBUG) process.stderr.write(dim(err.stack) + '\n');
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
