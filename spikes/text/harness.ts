/** Node-side helpers shared by the M0c scripts: bundling, server + browser, pixel analysis, contact sheets. */
import { build, type Plugin } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { launch, serve, PAINTED } from '../lib.ts';

export const HERE = import.meta.dirname;
export const SPIKES = join(HERE, '..');
export const BUILD = join(HERE, 'build');
export const OUT = join(HERE, 'out');
mkdirSync(BUILD, { recursive: true });
mkdirSync(OUT, { recursive: true });

/** Bundles `entry` to build/<outName>.js and writes build/<outName>.html that loads it. */
export async function bundle(entry: string, opts: { outName?: string; plugins?: Plugin[] } = {}): Promise<void> {
  const name = opts.outName ?? entry.replace(/\.ts$/, '');
  await build({ entryPoints: [join(HERE, entry)], bundle: true, format: 'esm', outfile: join(BUILD, `${name}.js`), logLevel: 'warning', plugins: opts.plugins });
  writeFileSync(
    join(BUILD, `${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body><script type="module" src="./${name}.js"></script></body></html>`,
  );
}

export interface Env {
  browser: Browser;
  url: string;
  analyzer: Analyzer;
  close(): Promise<void>;
}

/** Serves `spikes/` (so `/fonts/*` and `/text/build/*` resolve) and opens the analysis page. */
export async function start(): Promise<Env> {
  await bundle('analyze-page.ts');
  const server = await serve(SPIKES);
  const browser = await launch('shell');
  const analyzer = new Analyzer(await openPage(browser, `${server.url}/text/build/analyze-page.html`, { width: 400, height: 300 }));
  return {
    browser,
    url: server.url,
    analyzer,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

export async function openPage(browser: Browser, url: string, viewport: { width: number; height: number }): Promise<Page> {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto(url);
  await page.waitForFunction('window.T && window.T.ready === true', undefined, { timeout: 30_000 }).catch((e) => {
    throw new Error(`${url} never became ready: ${errors.join(' | ') || e}`);
  });
  return page;
}

export function pageErrors(page: Page): string[] {
  return (page as Page & { errors: string[] }).errors;
}

export async function shot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  await page.evaluate(PAINTED);
  return page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
}

export type BBox = [number, number, number, number]; // x0, y0, x1 (exclusive), y1 (exclusive)

export interface Diff {
  w: number;
  h: number;
  inkA: number;
  inkB: number;
  /** Pixels where |lum(A) - lum(B)| > threshold. */
  diffPx: number;
  inkUnion: number;
  /** diffPx / inkUnion × 100. */
  diffPctInk: number;
  /** diffPx / (w·h) × 100. */
  diffPctArea: number;
  bboxA: BBox;
  bboxB: BBox;
  /** Max abs difference over the 4 ink-bbox edges, px. */
  bboxShift: number;
  /** Same diff after translating B so its ink-bbox center matches A's (shape-only difference). */
  alignedDiffPctInk: number;
}

export interface Cell {
  png: Buffer;
  crop?: BBox;
}

/** Page-global API exposed by analyze-page.ts (the browser global is untyped from Node's side). */
export interface SheetSpec {
  title: string;
  scale: number;
  cols: string[];
  rows: { label: string; cells: ({ png: string; crop?: BBox } | null)[] }[];
}
export interface AnalyzeWindow {
  T: { diff(a: string, b: string, t: number): Promise<Diff>; overlay(a: string, b: string): Promise<string>; sheet(s: SheetSpec): Promise<string> };
}

export class Analyzer {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  diff(a: Buffer, b: Buffer, threshold = 64): Promise<Diff> {
    return this.page.evaluate(([a, b, t]) => {
      const api: AnalyzeWindow['T'] = Reflect.get(window, 'T');
      return api.diff(a, b, t);
    }, [a.toString('base64'), b.toString('base64'), threshold] as const);
  }

  /** Red = A only, cyan = B only, black = both. */
  async overlay(a: Buffer, b: Buffer): Promise<Buffer> {
    const b64 = await this.page.evaluate(([a, b]) => {
      const api: AnalyzeWindow['T'] = Reflect.get(window, 'T');
      return api.overlay(a, b);
    }, [a.toString('base64'), b.toString('base64')] as const);
    return Buffer.from(b64, 'base64');
  }

  /** Grid of cropped cells; one header row of column labels, a label per row. */
  async sheet(spec: { title: string; scale: number; cols: string[]; rows: { label: string; cells: (Cell | null)[] }[] }): Promise<Buffer> {
    const s = {
      ...spec,
      rows: spec.rows.map((r) => ({ label: r.label, cells: r.cells.map((c) => c && { png: c.png.toString('base64'), crop: c.crop }) })),
    };
    const b64 = await this.page.evaluate((s) => {
      const api: AnalyzeWindow['T'] = Reflect.get(window, 'T');
      return api.sheet(s);
    }, s);
    return Buffer.from(b64, 'base64');
  }
}

export function unionBox(boxes: BBox[], pad: number, limit: { w: number; h: number }): BBox {
  const valid = boxes.filter((b) => b[2] > b[0]);
  if (!valid.length) return [0, 0, limit.w, limit.h];
  return [
    Math.max(0, Math.min(...valid.map((b) => b[0])) - pad),
    Math.max(0, Math.min(...valid.map((b) => b[1])) - pad),
    Math.min(limit.w, Math.max(...valid.map((b) => b[2])) + pad),
    Math.min(limit.h, Math.max(...valid.map((b) => b[3])) + pad),
  ];
}

export function writeOut(name: string, data: Buffer | string): string {
  const path = join(OUT, name);
  writeFileSync(path, data);
  return `spikes/text/out/${name}`;
}

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
