/**
 * Capture worker (PLAN.md §8.1): chrome-headless-shell with the GPU on, `window.REEL` injected before any page
 * script, Math.random seeded per frame, frames grabbed with CDP `Page.captureScreenshot` (never `page.screenshot`).
 */
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import type { ReelInput, SoundCue, TextBox } from '@reel/core';

/**
 * M0a: Metal WebGL2 on the M1 Pro in chrome-headless-shell.
 * `--disable-partial-raster`: with partial raster Chromium re-rasters only dirty tiles, so anti-aliased edges can keep
 * the previous frame's pixels (measured up to 8/255 order dependence in M2). Part of the chunk cache key.
 */
export const GPU_ARGS = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-partial-raster'];

/**
 * `raster: 'cpu'` swaps GPU tile raster for Skia's CPU raster (WebGL and compositing stay on the GPU). M6: the GPU
 * glyph atlas makes text pixels depend on earlier frames under load (3–11/255 on sticker-pop, neon, glyph-morph;
 * not reproducible in isolation), while CPU raster measured 0/255 on the same frames. Chunks keep GPU raster: CPU
 * raster costs +50 % at standard and 3.2× at final (dilemma 9:16: 196 s → 625 s), and every chunk renders in one
 * fixed order in a fresh context, so its pixels stay reproducible. The purity probe (`gateDeterminism`) uses CPU
 * raster, so its forward/reverse check measures the page, not the atlas.
 */
export function launchBrowser(o: { raster?: 'gpu' | 'cpu' } = {}): Promise<Browser> {
  const args = o.raster === 'cpu' ? GPU_ARGS.map((a) => (a === '--enable-gpu-rasterization' ? '--disable-gpu-rasterization' : a)) : GPU_ARGS;
  return chromium.launch({ headless: true, args });
}

export interface ShotOptions {
  format: 'jpeg' | 'png';
  /** JPEG quality 0–100 (ignored for PNG). */
  quality?: number;
  /** Supersample factor; CDP ignores deviceScaleFactor unless the clip carries `scale` (M0b). */
  scale?: number;
}

/**
 * Runs before any page script. The Math.random generator is OpenKatana's SEED (mulberry32), reseeded by the
 * worker before every `seek(t)` with a value derived from `t` only, so random-using styles stay pure functions of t.
 */
function initScript(input: ReelInput): string {
  return `(() => {
  let a = 0x9E3779B9;
  Object.defineProperty(window, '__reelSeed', { value: (f) => { a = (f * 2654435761 + 97) >>> 0; } });
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const violations = [];
  Object.defineProperty(window, '__reelViolations', { value: violations });
  document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective + ': ' + String(e.blockedURI).slice(0, 200)));
  window.REEL = ${JSON.stringify(input)};
})();`;
}

type SeedWindow = Window & { __reelSeed(f: number): void; __reelViolations: string[] };

/** Seed for the frame at `t`: integer microseconds, so sub-frames get their own sequence. */
const seedOf = (t: number) => Math.round(t * 1e6);

const READY_TIMEOUT_MS = 60_000;

/** One reel page in its own browser context (viewport = format W×H). */
export class ReelTab {
  readonly width: number;
  readonly height: number;
  readonly #ctx: BrowserContext;
  readonly #page: Page;
  readonly #cdp: CDPSession;
  readonly #problems: string[];

  private constructor(ctx: BrowserContext, page: Page, cdp: CDPSession, w: number, h: number, problems: string[]) {
    this.#ctx = ctx;
    this.#page = page;
    this.#cdp = cdp;
    this.width = w;
    this.height = h;
    this.#problems = problems;
  }

  /** Opens `<origin>/<entry>` with `input` injected and resolves once `reelPage.ready()` has resolved. */
  static async open(browser: Browser, o: { origin: string; entry: string; input: ReelInput }): Promise<ReelTab> {
    const { w, h } = o.input.format;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const problems: string[] = [];
    try {
      await ctx.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(o.origin + '/')) return route.continue();
        problems.push(`off-host request blocked: ${url.slice(0, 200)}`);
        return route.abort('blockedbyclient');
      });
      await ctx.addInitScript(initScript(o.input));
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
      page.on('crash', () => problems.push('page crashed'));
      const cdp = await ctx.newCDPSession(page);
      const tab = new ReelTab(ctx, page, cdp, w, h, problems);
      const res = await page.goto(`${o.origin}/${o.entry}`, { waitUntil: 'load' });
      if (!res?.ok()) throw new Error(`bundle entry ${o.entry} answered ${res?.status() ?? 'nothing'}`);
      await page.waitForFunction(() => !!window.reelPage, undefined, { timeout: READY_TIMEOUT_MS });
      await withTimeout(
        page.evaluate(() => {
          (window as unknown as SeedWindow).__reelSeed(0);
          return window.reelPage.ready();
        }),
        READY_TIMEOUT_MS,
        'reelPage.ready()',
      );
      await tab.check();
      return tab;
    } catch (e) {
      await ctx.close().catch(() => {});
      if (problems.length) throw new Error(`${(e as Error).message}\n  ${problems.join('\n  ')}`);
      throw e;
    }
  }

  async seek(t: number): Promise<void> {
    await this.#page.evaluate(
      ([x, seed]) => {
        (window as unknown as SeedWindow).__reelSeed(seed);
        return window.reelPage.seek(x);
      },
      [t, seedOf(t)] as const,
    );
  }

  async shot(o: ShotOptions): Promise<Buffer> {
    const scale = o.scale ?? 1;
    const { data } = await this.#cdp.send('Page.captureScreenshot', {
      format: o.format,
      ...(o.format === 'jpeg' ? { quality: o.quality ?? 95 } : {}),
      optimizeForSpeed: true,
      ...(scale !== 1 ? { clip: { x: 0, y: 0, width: this.width, height: this.height, scale } } : {}),
    });
    return Buffer.from(data, 'base64');
  }

  /** `seek(t)` then capture, for each time in order. */
  async *captureRange(times: readonly number[], o: ShotOptions): AsyncGenerator<Buffer> {
    for (const t of times) {
      await this.seek(t);
      yield await this.shot(o);
    }
  }

  fingerprint(t0: number, t1: number): Promise<unknown> {
    return this.#page.evaluate(([a, b]) => window.reelPage.fingerprint(a, b), [t0, t1] as const);
  }

  /** The page's sound cues (valid after `ready()`, which `open` awaited). */
  soundCues(): Promise<SoundCue[]> {
    return this.#page.evaluate(() => window.reelPage.soundCues());
  }

  boxes(): Promise<TextBox[]> {
    return this.#page.evaluate(() => window.reelPage.boxes());
  }

  /** CSP violations, page errors and blocked requests so far; any of them fails the job. */
  async problems(): Promise<string[]> {
    const csp = await this.#page
      .evaluate(() => [...(window as unknown as SeedWindow).__reelViolations])
      .catch((e: Error) => [`page unreachable: ${e.message}`]);
    return [...this.#problems, ...csp.map((v) => `CSP violation: ${v}`)];
  }

  async check(): Promise<void> {
    const p = await this.problems();
    if (p.length) throw new Error(`page integrity failed:\n  ${p.join('\n  ')}`);
  }

  async close(): Promise<void> {
    await this.#page.evaluate(() => window.reelPage?.destroy?.()).catch(() => {});
    await this.#ctx.close().catch(() => {});
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  const { promise, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(`${what} did not resolve within ${ms / 1000} s`)), ms);
  return Promise.race([p, promise]).finally(() => clearTimeout(timer));
}
