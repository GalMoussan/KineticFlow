/**
 * Style stills (`POST /api/style-stills`): the user's own content in several styles, captured headless from the same
 * preview page at a section hold, as scaled JPEGs cached by fingerprint. One warm browser, at most `SLOTS` pages at
 * once. A style that cannot lay out the content (roles, timing, fonts) answers with `error` instead of a URL.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StyleStill } from '@reel/api';
import { format as formatOf, type FormatId } from '@reel/core';
import { launchBrowser, ReelTab, touch, type Browser } from '@reel/render';
import { RECIPES } from '@reel/styles';
import { HttpError } from './http.ts';
import type { PreviewService } from './preview.ts';

const SLOTS = 3;
/** Cache hit check that also marks the entry as recently used for the LRU (`pruneCaches`). */
const exists = (p: string) => access(p).then(async () => (await touch(p), true), () => false);

/** The draft re-styled as one catalog style: its default palette, no per-section looks, no music (visual grid). */
export function restyle(raw: unknown, style: string): Record<string, unknown> {
  const spec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const r = RECIPES[style]!;
  const sections = Array.isArray(spec.sections)
    ? spec.sections.map((s) => {
        if (!s || typeof s !== 'object') return s;
        const { style: _s, palette: _p, ...rest } = s as Record<string, unknown>;
        return rest;
      })
    : spec.sections;
  return { ...spec, sections, style, palette: r.defaults.palette, music: { source: 'none' }, sfx: false };
}

export class StillService {
  readonly #preview: PreviewService;
  readonly #dir: string;
  readonly #origin: () => string;
  readonly #log: (msg: string) => void;
  #browser: Promise<Browser> | null = null;
  #free = SLOTS;
  readonly #waiting: (() => void)[] = [];
  readonly #inflight = new Map<string, Promise<StyleStill>>();

  constructor(o: { preview: PreviewService; dir: string; origin: () => string; log: (msg: string) => void }) {
    this.#preview = o.preview;
    this.#dir = o.dir;
    this.#origin = o.origin;
    this.#log = o.log;
  }

  #getBrowser(): Promise<Browser> {
    if (!this.#browser) {
      const b = launchBrowser();
      this.#browser = b;
      b.then(
        (br) => br.on('disconnected', () => (this.#browser = null)),
        () => (this.#browser = null),
      );
    }
    return this.#browser;
  }

  async #slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#free === 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.#waiting.push(resolve);
      await promise;
    } else this.#free--;
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free++;
    }
  }

  async stills(req: { spec: unknown; styles: string[]; format: FormatId; section?: string | undefined; width: number }): Promise<StyleStill[]> {
    const t0 = performance.now();
    const out = await Promise.all(req.styles.map((style) => this.#still(req, style)));
    const made = out.filter((s) => s.url).length;
    this.#log(`stills ${req.styles.length} style(s) ${req.format} · ${made} ok · ${Math.round(performance.now() - t0)} ms`);
    return out;
  }

  #still(req: { spec: unknown; format: FormatId; section?: string | undefined; width: number }, style: string): Promise<StyleStill> {
    if (!RECIPES[style]) return Promise.resolve({ style, error: `unknown style "${style}"` });
    const spec = restyle(req.spec, style);
    const key = createHash('sha256')
      .update(JSON.stringify({ v: 1, spec, format: req.format, section: req.section ?? null, width: req.width }))
      .digest('hex')
      .slice(0, 24);
    let job = this.#inflight.get(key);
    if (!job) {
      job = this.#capture(spec, style, key, req).finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, job);
    }
    return job;
  }

  async #capture(spec: Record<string, unknown>, style: string, key: string, req: { format: FormatId; section?: string | undefined; width: number }): Promise<StyleStill> {
    const file = `${key}.jpg`;
    const url = `/files/preview/stills/${file}`;
    const path = join(this.#dir, file);
    if (await exists(path)) return { style, url };
    let created;
    try {
      created = await this.#preview.create(spec, req.format, { quiet: true });
    } catch (e) {
      return { style, error: e instanceof HttpError ? e.message : `cannot lay out this content: ${(e as Error).message}` };
    }
    const { session, response } = created;
    const section = (req.section && response.sections.find((s) => s.id === req.section)) || response.sections.find((s) => s.role === 'title') || response.sections[0]!;
    const t = section.holdEnd > section.holdStart ? (section.holdStart + section.holdEnd) / 2 : Math.max(0, section.holdEnd - 1 / response.fps);
    const f = formatOf(req.format);
    try {
      const jpg = await this.#slot(async () => {
        const browser = await this.#getBrowser();
        const tab = await ReelTab.open(browser, { origin: this.#origin(), entry: response.url.slice(1), input: session.input });
        try {
          await tab.seek(t);
          return await tab.shot({ format: 'jpeg', quality: 82, scale: req.width / f.w });
        } finally {
          await tab.close();
        }
      });
      await mkdir(this.#dir, { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, jpg);
      await rename(tmp, path);
      return { style, url };
    } catch (e) {
      return { style, error: `capture failed: ${(e as Error).message.split('\n')[0]}` };
    }
  }

  async close(): Promise<void> {
    const b = this.#browser;
    this.#browser = null;
    if (b) await (await b).close().catch(() => {});
  }
}
