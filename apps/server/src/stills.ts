/**
 * Style stills (`POST /api/style-stills`): the user's own content in several styles, captured headless from the same
 * preview page at a section hold, as scaled JPEGs cached by fingerprint. A project with sketches is shown at its first
 * sketched section once the sketches are drawn, so each card shows how that style draws them. One warm browser, at most
 * `SLOTS` pages at once. A style that cannot lay out the content (roles, timing, fonts) answers with `error` instead of a URL.
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

/**
 * The draft re-styled as one catalog style: its default palette, no per-section looks, no music (visual grid). The
 * style's default fonts replace the draft's unless the user chose fonts that are no style's default (a brand font),
 * matching what picking the style does in the editor.
 */
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
  const fonts = spec.fonts as { display?: string; text?: string } | undefined;
  const brand = !!fonts?.text || !Object.values(RECIPES).some((x) => x.defaults.fonts.display === fonts?.display);
  return {
    ...spec,
    sections,
    style,
    palette: r.defaults.palette,
    ...(brand ? {} : { fonts: { ...r.defaults.fonts } }),
    music: { source: 'none' },
    sfx: false,
  };
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
      .update(JSON.stringify({ v: 2, spec, format: req.format, section: req.section ?? null, width: req.width }))
      .digest('hex')
      .slice(0, 24);
    let job = this.#inflight.get(key);
    if (!job) {
      job = this.#capture(spec, style, key, req).finally(() => this.#inflight.delete(key));
      this.#inflight.set(key, job);
    }
    return job;
  }

  /**
   * The preview session is created inside the capture slot: sessions live in a bounded LRU, so creating all of a
   * large request's sessions up front (25 styles) evicted the first ones before their capture and their page 404'd.
   */
  async #capture(spec: Record<string, unknown>, style: string, key: string, req: { format: FormatId; section?: string | undefined; width: number }): Promise<StyleStill> {
    const file = `${key}.jpg`;
    const url = `/files/preview/stills/${file}`;
    const path = join(this.#dir, file);
    if (await exists(path)) return { style, url };
    const f = formatOf(req.format);
    const shot = await this.#slot(async (): Promise<Uint8Array | StyleStill> => {
      let created;
      try {
        created = await this.#preview.create(spec, req.format, { quiet: true });
      } catch (e) {
        return { style, error: e instanceof HttpError ? e.message : `cannot lay out this content: ${(e as Error).message}` };
      }
      const { session, response } = created;
      // the project's first sketched section (so each card shows how its style draws the sketches), else the title
      const cues = session.input.cues.cues;
      const sketched = response.sections.find((s) => cues.some((c) => c.type === 'sketch-in' && c.section === s.id));
      const section =
        (req.section && response.sections.find((s) => s.id === req.section)) || sketched || response.sections.find((s) => s.role === 'title') || response.sections[0]!;
      let t = section.holdEnd > section.holdStart ? (section.holdStart + section.holdEnd) / 2 : Math.max(0, section.holdEnd - 1 / response.fps);
      // a sketched section: once its sketches are fully drawn, before any of them leaves
      const own = cues.filter((c) => c.section === section.id && c.sketch !== undefined);
      if (own.length) {
        const drawn = Math.max(...own.filter((c) => c.type === 'sketch-in').map((c) => c.until!));
        const leaves = Math.min(section.holdEnd, ...own.filter((c) => c.type === 'sketch-out').map((c) => c.t)) - 1 / response.fps;
        t = Math.max(0, Math.min(Math.max(t, drawn), leaves));
      }
      try {
        const browser = await this.#getBrowser();
        const tab = await ReelTab.open(browser, { origin: this.#origin(), entry: response.url.slice(1), input: session.input });
        try {
          await tab.seek(t);
          return await tab.shot({ format: 'jpeg', quality: 82, scale: req.width / f.w });
        } finally {
          await tab.close();
        }
      } catch (e) {
        return { style, error: `capture failed: ${(e as Error).message.split('\n')[0]}` };
      }
    });
    if (!(shot instanceof Uint8Array)) return shot;
    await mkdir(this.#dir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, shot);
    await rename(tmp, path);
    return { style, url };
  }

  async close(): Promise<void> {
    const b = this.#browser;
    this.#browser = null;
    if (b) await (await b).close().catch(() => {});
  }
}
