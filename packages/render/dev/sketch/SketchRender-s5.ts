/**
 * P0 spike S5: one sketch overlay in the real page (host/spike-sketch.ts, `// SPIKE (P0)`).
 *
 *   node packages/render/dev/sketch/SketchRender-s5.ts make
 *       → out/sketch/S5/event-he-{sketch,line}.json: examples/test-set/event-he.json + `__spikeSketch` on section 2
 *         (tagline-1), and an `assets` symlink so the endcard logos resolve.
 *   node packages/render/dev/sketch/SketchRender-s5.ts probe --spec <spike spec> --style <id> [--formats 9:16]
 *       → composited layers (CDP LayerTree) with and without the sketch at times around the sketch window, and the
 *         per-frame page cost of the sketch window with and without it (GPU raster, the renderer's flags).
 *
 * The determinism and fingerprint checks themselves are `packages/traits/dev/stills.ts` (see the report).
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser, CDPSession, Page } from 'playwright';
import { JobSpec, type FormatId } from '@reel/core';
import { buildCueSheet } from '../../../timing/src/index.ts';
import { RECIPES, recipe } from '../../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../../../traits/src/index.ts';
import { buildBundle } from '../../src/bundle.ts';
import { reelInput } from '../../src/reel-input.ts';
import { launchBrowser } from '../../src/capture.ts';
import { lineDoc, sketchDoc } from './SketchRender-docs.ts';
import { attribute, stats, TRACE_CATEGORIES, type Stat, type TraceEvent } from './SketchRender-trace.ts';
import type * as PngJs from 'pngjs';

const { PNG } = createRequire(import.meta.url)('pngjs') as typeof PngJs;
const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '../../../..');
const S5 = join(REPO, 'out/sketch/S5');
const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: { spec: { type: 'string' }, style: { type: 'string' }, formats: { type: 'string' } },
});

const PLACE = { x: 0.56, y: 0.6, w: 0.42 };

async function make(): Promise<void> {
  await mkdir(S5, { recursive: true });
  const base = JSON.parse(await readFile(join(REPO, 'examples/test-set/event-he.json'), 'utf8'));
  const variants = {
    sketch: { doc: sketchDoc(), approach: 'boil-shift', color: 'accent' },
    line: { doc: lineDoc(), approach: 'dash', color: 'text' },
  } as const;
  for (const [name, v] of Object.entries(variants)) {
    const spec = { ...base, id: `ts-event-he-spike-${name}`, __spikeSketch: { ...v, section: 'tagline-1', beats: 2, place: PLACE } };
    await writeFile(join(S5, `event-he-${name}.json`), JSON.stringify(spec, null, 1));
  }
  await symlink('../../../examples/test-set/assets', join(S5, 'assets')).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e;
  });
  console.log(`specs → ${S5}/event-he-{sketch,line}.json`);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.woff2': 'font/woff2',
};

interface Reel {
  page: Page;
  cdp: CDPSession;
  window: { tIn: number; tOut: number; holdEnd: number };
  close(): Promise<void>;
}

/** Bundle + REEL for one spec (with `--style` applied as stills.ts does) and one format, opened in `browser`. */
async function openReel(browser: Browser, raw: Record<string, unknown>, specDir: string, fmt: FormatId, name: string): Promise<Reel> {
  const spec = JobSpec.parse(raw);
  if (raw.__spikeSketch) Object.assign(spec, { __spikeSketch: raw.__spikeSketch });
  const styles = resolveStyles(spec, RECIPES, TRAIT_META);
  assertResolved(styles);
  const rec = recipe(styles.job.recipe);
  const bpm = spec.music.source === 'preset' ? spec.music.bpm : rec.defaults.music.bpm;
  const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm, fps: 30 });
  const bundle = await buildBundle({ spec, specDir, outDir: join(S5, `bundle-${name}`), traits: usedTraits(styles) });
  const input = await reelInput({ spec, sheet, formatId: fmt, specDir, bundle, styles });
  const ctx = await browser.newContext({ viewport: { width: input.format.w, height: input.format.h }, deviceScaleFactor: 1 });
  await ctx.route('http://reel.local/**', async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname);
    await route.fulfill({ body: await readFile(join(bundle.dir, rel)), contentType: TYPES[extname(rel)] ?? 'application/octet-stream' });
  });
  await ctx.addInitScript((reel) => {
    Object.assign(window, { REEL: reel });
  }, input);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`pageerror: ${e.message}`));
  await page.goto('http://reel.local/index.html');
  await page.evaluate(() => window.reelPage.ready());
  const cdp = await ctx.newCDPSession(page);
  // the sketch's own window (tIn, tOut) from its fingerprint entry; the plain spec falls back to the section's
  const sec = sheet.sections.find((s) => s.id === 'tagline-1')!.timing;
  const fp = (await page.evaluate((d) => window.reelPage.fingerprint(0, d), sheet.duration)) as { spikeSketch?: { tIn: number; tOut: number } };
  const w = { tIn: fp.spikeSketch?.tIn ?? sec.holdStart, tOut: fp.spikeSketch?.tOut ?? sec.out, holdEnd: sec.holdEnd };
  return { page, cdp, window: w, close: () => ctx.close() };
}

function maxDelta(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a).data;
  const pb = PNG.sync.read(b).data;
  if (pa.length !== pb.length) return 255;
  let m = 0;
  for (let i = 0; i < pa.length; i++) m = Math.max(m, Math.abs(pa[i]! - pb[i]!));
  return m;
}

/**
 * stills.ts's checks (a)/(b)/(c) sample fixed times that miss a section-2 sketch, so the same three checks again on
 * frames inside the sketch window: (a) forward then reverse in one page, (c) each frame right after every other one,
 * (b) a fresh browser, same order. CPU raster (the purity probe) and GPU raster (the chunk renderer).
 */
async function windowDeterminism(raw: Record<string, unknown>, specDir: string, fmt: FormatId, w: Reel['window']): Promise<Record<string, { a: number; b: number; c: number; frames: number[] }>> {
  const dur = w.tOut - w.tIn;
  const times = [0.02, 0.12, 0.25, 0.4, 0.55, 0.7, 0.9].map((k) => Math.round((w.tIn + k * dur) * 30) / 30);
  const out: Record<string, { a: number; b: number; c: number; frames: number[] }> = {};
  for (const raster of ['cpu', 'gpu'] as const) {
    const idx = times.map((_, i) => i);
    // every frame again right after each other window frame and after the intro / earlier and later sections
    const others = [...times, 0.5, 2.4, 14.3, 22.7];
    /** One fresh browser: forward; then (unless `quick`) reverse and history in the same page. */
    const session = async (quick: boolean): Promise<{ fwd: Buffer[]; rev: [number, Buffer][]; hist: [number, Buffer][] }> => {
      const browser = await launchBrowser({ raster });
      try {
        const r = await openReel(browser, raw, specDir, fmt, `det-${raster}`);
        const shot = async (t: number): Promise<Buffer> => {
          await r.page.evaluate((x) => window.reelPage.seek(x), t);
          const { data } = await r.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
          return Buffer.from(data, 'base64');
        };
        const fwd: Buffer[] = [];
        for (const i of idx) fwd.push(await shot(times[i]!));
        const rev: [number, Buffer][] = [];
        const hist: [number, Buffer][] = [];
        if (!quick) {
          for (const i of [...idx].reverse()) rev.push([i, await shot(times[i]!)]);
          for (const i of idx) {
            for (const o of others) {
              if (o === times[i]) continue;
              await r.page.evaluate((x) => window.reelPage.seek(x), o);
              hist.push([i, await shot(times[i]!)]);
            }
          }
        }
        await r.close();
        return { fwd, rev, hist };
      } finally {
        await browser.close();
      }
    };
    const first = await session(false);
    const second = await session(true);
    const md = (xs: [number, Buffer][]) => Math.max(0, ...xs.map(([i, b]) => maxDelta(first.fwd[i]!, b)));
    out[raster] = { a: md(first.rev), b: md(second.fwd.map((b, i): [number, Buffer] => [i, b])), c: md(first.hist), frames: times };
    console.log(`[${fmt}] in-window determinism (${raster} raster): (a) reverse ${out[raster].a}/255 · (b) fresh ${out[raster].b}/255 · (c) history ${out[raster].c}/255 · frames ${times.join(', ')}`);
  }
  return out;
}

interface LayerRow {
  node: string;
  size: string;
  reasons: string[];
  /** The layer's node is (inside) a text unit, or contains one. */
  text: boolean;
}

async function layerTree(r: Reel, t: number): Promise<LayerRow[]> {
  await r.page.evaluate((x) => window.reelPage.seek(x), t);
  let last: { layerId: string; backendNodeId?: number; width: number; height: number }[] = [];
  const on = (e: { layers?: typeof last }): void => {
    if (e.layers) last = e.layers;
  };
  r.cdp.on('LayerTree.layerTreeDidChange', on);
  await r.cdp.send('DOM.enable');
  await r.cdp.send('LayerTree.enable');
  await r.page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    return promise;
  });
  await r.cdp.send('LayerTree.disable');
  r.cdp.off('LayerTree.layerTreeDidChange', on);
  const rows: LayerRow[] = [];
  for (const l of last) {
    let reasons: string[] = [];
    try {
      reasons = (await r.cdp.send('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasonIds ?? [];
    } catch {}
    let node = '(root)';
    let text = false;
    if (l.backendNodeId) {
      const d = await r.cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId });
      const cls = d.node.attributes?.[d.node.attributes.indexOf('class') + 1];
      node = `${d.node.nodeName.toLowerCase()}${cls && d.node.attributes?.includes('class') ? `.${cls.replace(/ /g, '.')}` : ''}`;
      const { object } = await r.cdp.send('DOM.resolveNode', { backendNodeId: l.backendNodeId });
      const res = await r.cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId!,
        functionDeclaration: 'function () { return !!(this.closest && (this.closest(".u") || this.querySelector(".t"))); }',
        returnByValue: true,
      });
      text = res.result.value === true;
    }
    rows.push({ node, size: `${l.width}×${l.height}`, reasons, text });
  }
  return rows;
}

/** Page cost per frame over the sketch window at 30 fps, traced (seek + paint barrier + JPEG capture). */
async function cost(browser: Browser, r: Reel): Promise<{ frames: number; main: Stat; busy: Stat; script: Stat; paint: Stat; raster: Stat }> {
  const times: number[] = [];
  for (let t = Math.ceil(r.window.tIn * 30) / 30; t < r.window.tOut; t += 1 / 30) times.push(Math.round(t * 30) / 30);
  for (const t of times.slice(0, 6)) await r.page.evaluate((x) => window.reelPage.seek(x), t);
  await browser.startTracing(r.page, { categories: TRACE_CATEGORIES });
  for (const [i, t] of times.entries()) {
    await r.page.evaluate(
      async ([i, t]) => {
        performance.mark(`f${i}`);
        await window.reelPage.seek(t);
      },
      [i, t] as const,
    );
    await r.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
  }
  await r.page.evaluate((n) => performance.mark(`f${n}`), times.length);
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
  const b = attribute(trace.traceEvents, times.length);
  return { frames: times.length, main: stats(b.map((x) => x.main)), busy: stats(b.map((x) => x.busy)), script: stats(b.map((x) => x.script)), paint: stats(b.map((x) => x.paint)), raster: stats(b.map((x) => x.raster)) };
}

async function probe(): Promise<void> {
  const specPath = resolve(args.spec!);
  const raw = JSON.parse(await readFile(specPath, 'utf8')) as Record<string, unknown>;
  if (args.style) {
    const d = recipe(args.style).defaults;
    Object.assign(raw, { style: args.style, palette: d.palette, fonts: { ...d.fonts } });
  }
  const plain = { ...raw };
  delete plain.__spikeSketch;
  const formats = (args.formats?.split(',') as FormatId[] | undefined) ?? ['9:16'];
  const out: Record<string, unknown> = {};
  for (const fmt of formats) {
    const browser = await launchBrowser();
    try {
      const withSk = await openReel(browser, raw, dirname(specPath), fmt, 'probe-sketch');
      const without = await openReel(browser, plain, dirname(specPath), fmt, 'probe-plain');
      without.window = withSk.window;
      // fingerprints in 1 s windows (chunk-sized): only windows overlapping [tIn, tOut) may differ
      const fpChanged: string[] = [];
      for (let t0 = 0; t0 < 26; t0++) {
        const [a, b] = await Promise.all([withSk, without].map((r) => r.page.evaluate(([x, y]) => JSON.stringify(window.reelPage.fingerprint(x, y)), [t0, t0 + 1] as const)));
        if (a !== b) fpChanged.push(`[${t0}, ${t0 + 1})`);
      }
      console.log(`[${fmt}] fingerprint windows that differ from the plain spec: ${fpChanged.join(' ') || 'none'} (sketch on screen ${withSk.window.tIn.toFixed(3)}..${withSk.window.tOut.toFixed(3)})`);
      const { tIn, tOut, holdEnd } = withSk.window;
      const times = [tIn - 0.2, tIn + 0.1, tIn + 0.4, holdEnd - 1 / 30, tIn + 1, (tIn + tOut) / 2, tOut - 0.15, tOut + 0.2].map((t) => Math.round(t * 30) / 30);
      const layers: Record<string, { sketch: LayerRow[]; plain: LayerRow[] }> = {};
      for (const t of times) {
        layers[t.toFixed(3)] = { sketch: await layerTree(withSk, t), plain: await layerTree(without, t) };
        const L = layers[t.toFixed(3)]!;
        const fmtRows = (rows: LayerRow[]) => rows.map((x) => `${x.node}${x.text ? '[TEXT]' : ''}(${x.reasons.join(',') || '-'})`).join(' | ');
        console.log(`[${fmt}] t=${t.toFixed(3)} layers sketch ${L.sketch.length}: ${fmtRows(L.sketch)}`);
        console.log(`[${fmt}] t=${t.toFixed(3)} layers plain  ${L.plain.length}: ${fmtRows(L.plain)}`);
      }
      const c = [];
      for (let run = 0; run < 3; run++) c.push({ run, sketch: await cost(browser, withSk), plain: await cost(browser, without) });
      for (const x of c) console.log(`[${fmt}] cost run ${x.run}: sketch busy ${x.sketch.busy.median}/${x.sketch.busy.p95} main ${x.sketch.main.median}/${x.sketch.main.p95} raster ${x.sketch.raster.median}/${x.sketch.raster.p95} · plain busy ${x.plain.busy.median}/${x.plain.busy.p95} main ${x.plain.main.median}/${x.plain.main.p95} raster ${x.plain.raster.median}/${x.plain.raster.p95} (${x.sketch.frames} frames)`);
      out[fmt] = { window: withSk.window, fpChanged, layers, cost: c, determinism: await windowDeterminism(raw, dirname(specPath), fmt, withSk.window) };
      await withSk.close();
      await without.close();
    } finally {
      await browser.close();
    }
  }
  const name = `probe-${String(args.style ?? 'spec')}-${String(raw.id)}`;
  await writeFile(join(S5, `${name}.json`), JSON.stringify(out, null, 1));
  console.log(`→ ${join(S5, `${name}.json`)}`);
}

if (positionals[0] === 'make') await make();
else if (positionals[0] === 'probe') await probe();
else throw new Error('usage: SketchRender-s5.ts make | probe --spec <path> --style <id> [--formats 9:16,1:1]');
