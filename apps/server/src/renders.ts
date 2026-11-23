/**
 * Render queue: FIFO, one job at a time (each job already drives 4 GPU workers). Each job runs `renderJob` with an
 * `emit` that persists progress/QA/outputs, fans every `RenderEvent` out to SSE subscribers and prints the CLI's
 * terminal lines. Cancel aborts the job at the next frame.
 */
import { spawn } from 'node:child_process';
import { relative, sep } from 'node:path';
import type { RenderOutput, RenderStreamEvent, RenderSummary } from '@reel/api';
import { JobSpec, type FormatId } from '@reel/core';
import { QaError, RenderCancelled, renderJob, type GateResult, type RenderEvent } from '@reel/render';
import { materialise } from './projects.ts';
import type { Paths } from './paths.ts';
import type { RenderRow, Store } from './store.ts';
import { renderPrinter } from './term.ts';

/** Topic → subscribers. `publish` never throws: a failing subscriber is dropped. */
export class Hub<T> {
  readonly #subs = new Map<string, Set<(e: T) => void>>();

  subscribe(topic: string, fn: (e: T) => void): () => void {
    let set = this.#subs.get(topic);
    if (!set) this.#subs.set(topic, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.#subs.delete(topic);
    };
  }

  publish(topic: string, e: T): void {
    for (const fn of [...(this.#subs.get(topic) ?? [])]) {
      try {
        fn(e);
      } catch {
        this.#subs.get(topic)?.delete(fn);
      }
    }
  }

  count(topic: string): number {
    return this.#subs.get(topic)?.size ?? 0;
  }
}

export const TERMINAL: readonly RenderSummary['state'][] = ['done', 'failed', 'cancelled'];

export function summary(r: RenderRow): RenderSummary {
  const { spec: _s, outDir: _o, ...rest } = r;
  return rest;
}

const gate = (g: GateResult): RenderSummary['qa'][number] => ({ gate: g.gate, level: g.level, ...(g.format ? { format: g.format } : {}), detail: g.detail });

/** A readable one-paragraph reason for a failed job. */
export function errorMessage(e: unknown): string {
  if (e instanceof QaError) {
    const failed = e.results.filter((r) => r.level === 'fail');
    return `QA failed: ${failed.map((g) => `${g.gate}${g.format ? ` ${g.format}` : ''}: ${g.detail}`).join('; ')}`;
  }
  const err = e as Error;
  if (['SpecError', 'TimingError', 'SetupError'].includes(err?.name)) return err.message;
  return err?.message?.split('\n')[0] ?? String(e);
}

export class RenderQueue {
  readonly #store: Store;
  readonly #paths: Paths;
  readonly #hub: Hub<RenderStreamEvent>;
  readonly #log: (msg: string) => void;
  readonly #print: boolean;
  #running: { id: string; abort: AbortController } | null = null;
  #idle: Promise<void> = Promise.resolve();

  constructor(o: { store: Store; paths: Paths; hub: Hub<RenderStreamEvent>; log: (msg: string) => void; print?: boolean }) {
    this.#store = o.store;
    this.#paths = o.paths;
    this.#hub = o.hub;
    this.#log = o.log;
    this.#print = o.print ?? true;
    for (const r of this.#store.listRenders({ states: ['running'] })) {
      this.#store.updateRender(r.id, { state: 'failed', error: 'the server stopped during this render', finished: true });
    }
    this.#pump();
  }

  /** Resolves when the queue has nothing left to run (tests). */
  idle(): Promise<void> {
    return this.#idle;
  }

  enqueue(o: { projectId: string; title: string; spec: unknown; quality: RenderSummary['quality']; formats: FormatId[] }): RenderSummary {
    const id = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
    const row = this.#store.insertRender({ id, ...o });
    this.#log(`render ${id} queued · ${o.title} · ${o.quality} · ${o.formats.join(',')}`);
    this.#publishState(id);
    this.#pump();
    return summary(row);
  }

  cancel(id: string): RenderSummary | undefined {
    const r = this.#store.getRender(id);
    if (!r) return undefined;
    if (r.state === 'queued') {
      this.#store.updateRender(id, { state: 'cancelled', finished: true });
      this.#log(`render ${id} cancelled (was queued)`);
      this.#publishState(id);
    } else if (r.state === 'running' && this.#running?.id === id) {
      this.#running.abort.abort();
      this.#log(`render ${id} cancelling…`);
    }
    return summary(this.#store.getRender(id)!);
  }

  /** Opens the job's output folder in Finder (selecting the first video). */
  reveal(id: string): boolean {
    const r = this.#store.getRender(id);
    if (!r?.outDir) return false;
    const first = r.outputs[0]?.video;
    const target = first ? `${this.#paths.out}${sep}${decodeURIComponent(first.replace(/^\/files\/out\//, ''))}` : r.outDir;
    if (process.env.REEL_NO_OPEN !== '1') spawn('open', first ? ['-R', target] : [target], { stdio: 'ignore', detached: true }).unref();
    return true;
  }

  #publishState(id: string): void {
    const r = this.#store.getRender(id);
    if (r) this.#hub.publish(id, { type: 'state', render: summary(r) });
  }

  #pump(): void {
    if (this.#running) return;
    const next = this.#store.listRenders({ states: ['queued'] }).at(-1);
    if (!next) return;
    const abort = new AbortController();
    this.#running = { id: next.id, abort };
    this.#idle = this.#run(next, abort.signal).finally(() => {
      this.#running = null;
      this.#pump();
    });
  }

  #url(path: string): string {
    return `/files/out/${relative(this.#paths.out, path).split(sep).map(encodeURIComponent).join('/')}`;
  }

  async #run(row: RenderRow, signal: AbortSignal): Promise<void> {
    const id = row.id;
    const t0 = performance.now();
    this.#store.updateRender(id, { state: 'running', progress: 0 });
    this.#publishState(id);
    this.#log(`render ${id} started · ${row.title}`);
    const printer = this.#print ? renderPrinter({ live: false, prefix: `[render ${id}]` }) : null;
    const qa: RenderSummary['qa'] = [];
    const outputs: RenderOutput[] = [];
    const chunks = new Map<string, { frames: number; done: number }>();
    let label = 'preparing';
    let lastProgress = 0;
    let lastSaved = 0;
    const progressOf = () => {
      let total = 0;
      let done = 0;
      for (const c of chunks.values()) {
        total += c.frames;
        done += Math.min(c.done, c.frames);
      }
      return total ? done / total : 0;
    };
    const progress = (force = false) => {
      const now = performance.now();
      if (!force && now - lastProgress < 200) return;
      lastProgress = now;
      const p = Math.round(progressOf() * 1000) / 1000;
      this.#hub.publish(id, { type: 'progress', progress: p, label });
      if (force || now - lastSaved > 1000) {
        lastSaved = now;
        this.#store.updateRender(id, { progress: p });
      }
    };
    const emit = (e: RenderEvent) => {
      printer?.emit(e);
      this.#hub.publish(id, { type: 'render', event: e });
      switch (e.type) {
        case 'spec':
          label = 'music';
          break;
        case 'music':
          label = 'building the page';
          break;
        case 'bundle':
          label = 'checking (QA)';
          break;
        case 'qa':
          qa.push(gate(e.result));
          this.#store.updateRender(id, { qa });
          return;
        case 'plan':
          for (const c of e.chunks) chunks.set(`${e.format}/${c.index}`, { frames: c.frames, done: c.cached ? c.frames : 0 });
          label = 'rendering';
          break;
        case 'chunk': {
          const c = chunks.get(`${e.format}/${e.index}`);
          if (c) c.done = e.done;
          label = `rendering ${e.format}`;
          break;
        }
        case 'chunk-done': {
          const c = chunks.get(`${e.format}/${e.index}`);
          if (c) c.done = c.frames;
          progress(true);
          return;
        }
        case 'rendered':
          label = 'mixing audio';
          break;
        case 'audio':
          label = 'exporting';
          break;
        case 'export': {
          const x = e.exported;
          outputs.push({
            format: x.format,
            video: this.#url(x.video.path),
            ...(x.noMusic ? { noMusic: this.#url(x.noMusic.path) } : {}),
            thumbnail: this.#url(x.thumbnail.path),
            bytes: x.video.bytes,
          });
          this.#store.updateRender(id, { outputs });
          break;
        }
        case 'done':
          label = 'done';
          this.#store.updateRender(id, { outDir: e.outDir });
          break;
      }
      progress(e.type !== 'chunk');
    };

    try {
      const parsed = JobSpec.parse(row.spec);
      const spec = { ...parsed, id: `${parsed.id}-${id}` };
      const specPath = await materialise({
        projects: this.#paths.projects,
        assets: this.#paths.assets,
        store: this.#store,
        projectId: row.projectId,
        spec,
        file: `render-${id}.json`,
      });
      const receipt = await renderJob(specPath, { quality: row.quality, formats: row.formats, outDir: this.#paths.out, signal }, emit);
      this.#store.updateRender(id, { state: 'done', progress: 1, outDir: receipt.outDir, outputs, qa: receipt.qa.map(gate), finished: true });
      this.#log(`render ${id} done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
      printer?.freeze();
      if (e instanceof RenderCancelled || signal.aborted) {
        this.#store.updateRender(id, { state: 'cancelled', finished: true });
        this.#log(`render ${id} cancelled`);
      } else {
        if (e instanceof QaError) qa.splice(0, qa.length, ...e.results.map(gate));
        const error = errorMessage(e);
        this.#store.updateRender(id, { state: 'failed', error, qa, outputs, finished: true });
        this.#log(`render ${id} failed: ${error}`);
        if (!(e instanceof QaError) && !['SpecError', 'TimingError', 'SetupError'].includes((e as Error).name) && (e as Error).stack) {
          process.stderr.write(`${(e as Error).stack}\n`);
        }
      }
    }
    this.#publishState(id);
  }
}
