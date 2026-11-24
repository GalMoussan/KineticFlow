/**
 * Terminal lines for render events (PLAN.md §8.5), shared by `reelgen render` and `reelgen serve`: spec, audio,
 * per-format chunk bars with cached marks, determinism, concat, export, QA.
 */
import { relative } from 'node:path';
import type { FormatId } from '@reel/core';
import type { GateResult, MusicInfo, RenderEvent } from '@reel/render';

export const tty = process.stdout.isTTY === true;
const color = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const dim = color('2');
export const green = color('32');
export const yellow = color('33');
export const red = color('31');
export const bold = color('1');
export const cyan = color('36');
const cwd = process.env.INIT_CWD ?? process.cwd();
export const rel = (p: string) => {
  const r = relative(cwd, p);
  return r.startsWith('..') ? p : r;
};
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const MARK = { pass: green('✓'), warn: yellow('⚠'), fail: red('✗') } as const;

/** Permanent lines scroll above a live block of progress lines that is redrawn in place (TTY only). */
class Screen {
  readonly #prefix: string;
  readonly #live: boolean;
  #lines: string[] = [];
  #drawn = 0;
  constructor(prefix: string, live: boolean) {
    this.#prefix = prefix;
    this.#live = live;
  }
  line(text: string, stream: NodeJS.WriteStream = process.stdout) {
    this.#clear();
    stream.write(`${this.#prefix} ${text}\n`);
    this.#draw();
  }
  live(lines: string[]) {
    this.#clear();
    this.#lines = lines;
    this.#draw();
  }
  /** Leaves the current live block on screen as permanent output. */
  freeze() {
    this.#lines = [];
    this.#drawn = 0;
  }
  #clear() {
    if (!this.#live || !this.#drawn) return;
    process.stdout.write(`\x1b[${this.#drawn}A\x1b[0J`);
    this.#drawn = 0;
  }
  #draw() {
    if (!this.#live || !this.#lines.length) return;
    const lines = this.#lines.map((l) => `${this.#prefix} ${l}`);
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

export function gateLine(phase: string, g: GateResult): string {
  const detail = g.detail.length > 200 ? `${g.detail.slice(0, 197)}…` : g.detail;
  return `QA ${MARK[g.level]} ${g.gate}${g.format ? ` ${g.format}` : ''} ${dim(`(${phase})`)} ${g.level === 'pass' ? dim(detail) : detail}`;
}

export function musicLine(m: MusicInfo): string {
  const ok = green('✓');
  switch (m.source) {
    case 'none':
      return `music ${ok} none (visual grid ${m.bpm} bpm)`;
    case 'preset':
      return `music ${ok} preset ${m.preset} · ${m.bpm} bpm · seed ${m.seed} · ${m.notes} notes ${dim(secs(m.ms))}`;
    case 'track':
    case 'ai': {
      const meter =
        m.meterConfidence === null
          ? 'no meter detected → bars of 4'
          : `meter ${m.meter} confidence ${m.meterConfidence.toFixed(2)}${m.downbeatsUsed ? '' : ' → downbeats ignored'}`;
      const trimmed = m.trimmed.head + m.trimmed.tail ? ` · ${m.trimmed.head + m.trimmed.tail} phantom beat(s) trimmed` : '';
      const what =
        m.source === 'track'
          ? `track ${m.file}`
          : `ai "${m.prompt.length > 40 ? `${m.prompt.slice(0, 39)}…` : m.prompt}" seed ${m.seed}${m.bpmHint ? ` (hint ${m.bpmHint} bpm)` : ''} · ` +
            (m.generation.cached ? 'clip cached' : `generated ${m.generation.seconds} s in ${secs(m.generation.ms)}`);
      return (
        `music ${ok} ${what} from ${m.offset.toFixed(2)} s · ${m.bpm.toFixed(1)} bpm · ${m.beats} beats, ${m.downbeats} downbeats · ` +
        `${meter}${trimmed} · analysis ${m.analysis.cached ? 'cached' : secs(m.analysis.ms)} ${dim(secs(m.ms))}`
      );
    }
  }
}

export interface RenderPrinter {
  emit(e: RenderEvent): void;
  /** Keeps the live progress block as permanent output (call when the job ends early). */
  freeze(): void;
}

/**
 * Prints a job's events. `live` (default: stdout is a TTY) redraws the chunk bars in place; otherwise a format's line
 * is printed when one of its chunks finishes and all lines every 5 s. `prefix` labels lines until the `spec` event
 * names the job.
 */
export function renderPrinter(o: { live?: boolean; prefix?: string } = {}): RenderPrinter {
  const live = o.live ?? tty;
  let screen = new Screen(dim(o.prefix ?? '[reelgen]'), live);
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
  /** Live: redraw the live block (≤ 12/s). Plain: one line for a format whose chunk just finished, all every 5 s. */
  const showProgress = (force: boolean, format?: FormatId) => {
    const now = performance.now();
    if (live) {
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
        screen = new Screen(dim(`[${e.job}]`), live);
        screen.line(
          `spec ok · ${e.sections} sections · ${e.duration.toFixed(1)} s · ${Number(e.bpm.toFixed(1))} bpm · formats ${e.formats.join(',')} · ${e.quality} (${e.fps} fps)`,
        );
        break;
      case 'bundle':
        screen.line(`bundle ${green('✓')} ${e.hash.slice(0, 12)}… · chromium ${e.chromium} ${dim(secs(e.ms))}`);
        break;
      case 'qa':
        screen.line(gateLine(e.phase, e.result), e.result.level === 'fail' ? process.stderr : process.stdout);
        break;
      case 'music':
        if (live) screen.live([]);
        screen.line(musicLine(e.info));
        break;
      case 'music-ai': {
        const text = `music ${bar(e.progress, 1, 20)} ${Math.round(e.progress * 100)}% ACE-Step · ${e.stage}`;
        if (live) screen.live([text]);
        else if (performance.now() - lastPlain > 5000 || e.progress === 1) {
          lastPlain = performance.now();
          screen.line(text);
        }
        break;
      }
      case 'sfx': {
        const kinds = Object.entries(e.byKind)
          .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
          .map(([k, n]) => `${n} ${k}`)
          .join(' · ');
        screen.line(
          e.enabled
            ? `sfx ${green('✓')} ${e.count} sound${e.count === 1 ? '' : 's'}${kinds ? `: ${kinds}` : ''} ${dim(secs(e.ms))}`
            : `sfx ${dim('– off (spec.sfx = false)')}`,
        );
        break;
      }
      case 'audio': {
        const noMusic = { sfx: ' · -no-music: SFX stem', silent: ' · -no-music: silent', off: '' }[e.noMusic];
        screen.line(
          !e.sha256
            ? `audio ${green('✓')} silence (${e.duration.toFixed(3)} s)${noMusic}`
            : `audio ${green('✓')} mix ${e.sha256.slice(0, 12)}… (${e.duration.toFixed(3)} s) → AAC 256k · ` +
                (e.lufs !== undefined
                  ? `${e.lufs.toFixed(1)} LUFS · TP ${e.tp?.toFixed(1)} dBTP · ${e.normalization ?? ''} loudnorm`
                  : 'SFX only, not normalised') +
                `${noMusic} ${dim(secs(e.ms))}`,
        );
        break;
      }
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
        if (live) {
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
      case 'cache':
        screen.line(
          `cache ${green('✓')} ${mb(e.left)} of ${mb(e.budget)} budget` +
            (e.removed ? ` · pruned ${e.removed} old entr${e.removed === 1 ? 'y' : 'ies'} (${mb(e.freed)})` : ''),
        );
        break;
      case 'done':
        screen.line(`done ${green('✓')} ${secs(e.ms)} · ${rel(e.receipt)}`);
        break;
    }
  };
  return { emit, freeze: () => screen.freeze() };
}
