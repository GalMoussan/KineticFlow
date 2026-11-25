/**
 * P0 spike S4: per-frame page cost of draw-on for 6000-point docs at 1080×1920, in the renderer's browser
 * (`launchBrowser()`: chrome-headless-shell, GPU raster, the renderer's flags), plus seek-order pixel identity,
 * composited-layer check, the contact sheet, and the dilemma baseline (frames without overlays).
 *
 *   node packages/render/dev/sketch/SketchRender-s4.ts [--runs 3] [--discover] [--skip-dilemma]
 *
 * Per frame (120 frames, p = 0..1): `seek` = JS update in the page (performance.now around `update`), then two rAFs
 * and a CDP JPEG q95 capture, as the renderer does. A Chromium trace attributes main-thread self time per frame to
 * script / style / layout / paint (+ GPU-process raster) between `performance.mark`s.
 * Output: out/sketch/S4/timings.json, out/dev/sketch-spikes/s4-drawon.png.
 */
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import type { Browser, CDPSession, Page } from 'playwright';
import type * as PngJs from 'pngjs';
import { FORMATS, JobSpec } from '@reel/core';
import { buildCueSheet } from '../../../timing/src/index.ts';
import { RECIPES, recipe } from '../../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../../../traits/src/index.ts';
import { buildBundle } from '../../src/bundle.ts';
import { reelInput } from '../../src/reel-input.ts';
import { launchBrowser } from '../../src/capture.ts';
import { problems, type SketchDoc } from './doc.ts';
import type { DrawApproach } from './SketchRender-draw.ts';
import { lineDoc, sketchDoc } from './SketchRender-docs.ts';
import { attribute, stats, TRACE_CATEGORIES, type Breakdown, type Stat, type TraceEvent } from './SketchRender-trace.ts';
import { sheet, type Cell } from './sheet.ts';

const { PNG } = createRequire(import.meta.url)('pngjs') as typeof PngJs;
const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '../../../..');
const OUT = join(REPO, 'out/sketch/S4');
const { values: args } = parseArgs({
  options: { runs: { type: 'string', default: '3' }, discover: { type: 'boolean' }, 'skip-dilemma': { type: 'boolean' }, only: { type: 'string' }, real: { type: 'boolean' } },
});
const RUNS = Number(args.runs);
const W = 1080;
const H = 1920;
const RECT = { x: 90, y: 520, w: 900, h: 900 };
const FRAMES = 120;

// ---------- page ----------
const drawJs = (
  await build({
    stdin: { contents: `import { mountDraw } from './SketchRender-draw.ts'; window.SR = { mountDraw };`, resolveDir: HERE, loader: 'ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  })
).outputFiles[0]!.text;

/** Stage like the host's: text in a content group, the overlay SVG in an `over` mount above it. */
const HTML = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>
html,body{margin:0;background:#f4efe6;overflow:hidden}
#stage{position:relative;width:${W}px;height:${H}px;overflow:clip}
.content,.over{position:absolute;left:0;top:0;width:100%;height:100%;overflow:clip}
.over{pointer-events:none}
.t{position:absolute;right:90px;font:900 120px system-ui,sans-serif;color:#2b2118;white-space:nowrap}
</style><body><div id="stage"><div class="content">
<div class="t" style="top:240px">קפה דילמה</div><div class="t" style="top:900px;font-size:96px">הנושאים הכי מעניינים</div>
<div class="t" style="top:1520px;font-size:110px">בואו לדבר!</div></div>
<div class="over"><svg id="ov" xmlns="http://www.w3.org/2000/svg"></svg></div></div></body></html>`;

interface Opened {
  page: Page;
  cdp: CDPSession;
  close(): Promise<void>;
}

async function openStage(browser: Browser): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.setContent(HTML);
  await page.addScriptTag({ content: drawJs });
  const cdp = await ctx.newCDPSession(page);
  return { page, cdp, close: () => ctx.close() };
}

type Approach = DrawApproach | 'none';

interface SpikeWindow {
  S: { update(p: number, t: number): void } | null;
  SR: { mountDraw(o: unknown): { update(p: number, t: number): void } };
}
const DOCS: Record<'line' | 'sketch', SketchDoc> = { line: lineDoc(), sketch: sketchDoc() };
const docFor = (a: Approach): SketchDoc => (a === 'prefix' || a === 'dash' ? DOCS.line : DOCS.sketch);

async function mount(o: Opened, a: Approach, doc: SketchDoc = docFor(a)): Promise<void> {
  await o.page.evaluate(
    ([doc, approach, rect]) => {
      // page globals set by this harness (drawJs defines SR; S is the mounted session)
      const w = window as unknown as SpikeWindow;
      const svg = document.getElementById('ov') as unknown as SVGSVGElement; // the <svg id="ov"> in HTML
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      w.S = approach === 'none' ? null : w.SR.mountDraw({ doc, svg, rect, overlayId: 'ov1', approach, color: '#1c1915' });
    },
    [doc, a, RECT] as const,
  );
}

/** One frame: mark, JS update (timed in page), two rAFs (the renderer's paint barrier). Returns JS ms. */
const frame = (o: Opened, i: number, p: number, t: number): Promise<number> =>
  o.page.evaluate(
    async ([i, p, t]) => {
      performance.mark(`f${i}`);
      const w = window as unknown as SpikeWindow; // page globals set by this harness
      const a = performance.now();
      w.S?.update(p, t);
      const js = performance.now() - a;
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      await promise;
      return js;
    },
    [i, p, t] as const,
  );

const shotJpeg = async (o: Opened): Promise<void> => {
  await o.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
};

async function shotPng(o: Opened, clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const { data } = await o.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  return Buffer.from(data, 'base64');
}

interface Series {
  js: number[];
  wall: number[];
  b: Breakdown[];
}

/** 120 frames of one approach in a fresh context, traced. */
async function measure(browser: Browser, a: Approach, discover: Map<string, number> | null, doc?: SketchDoc): Promise<Series> {
  const o = await openStage(browser);
  try {
    await mount(o, a, doc);
    for (let i = 0; i < 12; i++) {
      await frame(o, 1000 + i, i / 11, 10 + i / 30);
      await shotJpeg(o);
    }
    await browser.startTracing(o.page, { categories: TRACE_CATEGORIES });
    const js: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      const t0 = performance.now();
      js.push(await frame(o, i, i / (FRAMES - 1), 10 + i / 30));
      await shotJpeg(o);
      wall.push(performance.now() - t0);
    }
    await o.page.evaluate((n) => performance.mark(`f${n}`), FRAMES);
    const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
    return { js, wall, b: attribute(trace.traceEvents, FRAMES, discover) };
  } finally {
    await o.close();
  }
}

function maxDelta(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a).data;
  const pb = PNG.sync.read(b).data;
  if (pa.length !== pb.length) return 255;
  let m = 0;
  for (let i = 0; i < pa.length; i++) {
    const d = Math.abs(pa[i]! - pb[i]!);
    if (d > m) m = d;
  }
  return m;
}

// ---------- seek-order identity ----------
const PS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
const tOf = (p: number) => 10 + Math.round(p * 119) / 30;
async function orderCheck(raster: 'gpu' | 'cpu', a: DrawApproach): Promise<{ reverse: number; shuffled: number; fresh: number }> {
  const run = async (order: number[]): Promise<Buffer[]> => {
    const browser = await launchBrowser({ raster });
    try {
      const o = await openStage(browser);
      await mount(o, a);
      const out: Buffer[] = [];
      for (const k of order) {
        await frame(o, 2000 + k, PS[k]!, tOf(PS[k]!));
        out[k] = await shotPng(o);
      }
      // the same page again in another order: compare each frame with its first capture
      return out;
    } finally {
      await browser.close();
    }
  };
  const fwd = PS.map((_, i) => i);
  const base = await run(fwd);
  const rev = await run([...fwd].reverse());
  const shuf = await run([3, 6, 0, 5, 1, 4, 2]);
  const fresh = await run(fwd);
  // in-page history: one page, forward then each frame again after a far one
  const browser = await launchBrowser({ raster });
  let inPage = 0;
  try {
    const o = await openStage(browser);
    await mount(o, a);
    const first: Buffer[] = [];
    for (const k of fwd) {
      await frame(o, 3000 + k, PS[k]!, tOf(PS[k]!));
      first[k] = await shotPng(o);
    }
    for (const k of [...fwd].reverse()) {
      const far = PS[(k + 3) % PS.length]!;
      await frame(o, 4000 + k, far, tOf(far));
      await frame(o, 5000 + k, PS[k]!, tOf(PS[k]!));
      inPage = Math.max(inPage, maxDelta(first[k]!, await shotPng(o)));
    }
    await o.close();
  } finally {
    await browser.close();
  }
  const md = (xs: Buffer[]) => Math.max(...xs.map((b, i) => maxDelta(base[i]!, b)));
  return { reverse: Math.max(md(rev), inPage), shuffled: md(shuf), fresh: md(fresh) };
}

// ---------- composited layers ----------
async function layers(a: Approach): Promise<{ count: number; list: string[] }> {
  const browser = await launchBrowser();
  try {
    const o = await openStage(browser);
    await o.cdp.send('DOM.enable');
    await o.cdp.send('LayerTree.enable');
    let last: { layerId: string; backendNodeId?: number; drawsContent: boolean; width: number; height: number }[] = [];
    o.cdp.on('LayerTree.layerTreeDidChange', (e) => {
      if (e.layers) last = e.layers as typeof last;
    });
    await mount(o, a);
    for (const p of [0.3, 0.6]) {
      await frame(o, 6000, p, tOf(p));
      await shotPng(o);
    }
    const list: string[] = [];
    for (const l of last) {
      let reasons: string[] = [];
      try {
        reasons = ((await o.cdp.send('LayerTree.compositingReasons', { layerId: l.layerId })) as { compositingReasonIds?: string[] }).compositingReasonIds ?? [];
      } catch {}
      let node = '';
      if (l.backendNodeId) {
        try {
          const d = await o.cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId });
          node = `${d.node.nodeName.toLowerCase()}${d.node.attributes ? `[${d.node.attributes.join(' ').slice(0, 40)}]` : ''}`;
        } catch {}
      }
      list.push(`${node || '(root)'} ${l.width}×${l.height} draws=${l.drawsContent} reasons=${reasons.join(',') || '-'}`);
    }
    await o.close();
    return { count: last.length, list };
  } finally {
    await browser.close();
  }
}

// ---------- dilemma baseline: the real page without overlays ----------
async function dilemma(runs: number): Promise<Series[]> {
  const specPath = join(REPO, 'examples/dilemma.json');
  const spec = JobSpec.parse(JSON.parse(await readFile(specPath, 'utf8')));
  const styles = resolveStyles(spec, RECIPES, TRAIT_META);
  assertResolved(styles);
  const rec = recipe(styles.job.recipe);
  const bpm = spec.music.source === 'preset' ? spec.music.bpm : rec.defaults.music.bpm;
  const sheetCue = buildCueSheet({ spec, choreography: rec.choreography, bpm, fps: 30 });
  const bundle = await buildBundle({ spec, specDir: dirname(specPath), outDir: join(OUT, 'bundle-dilemma'), traits: usedTraits(styles) });
  const input = await reelInput({ spec, sheet: sheetCue, formatId: '9:16', specDir: dirname(specPath), bundle, styles });
  const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
  const out: Series[] = [];
  for (let r = 0; r < runs; r++) {
    const browser = await launchBrowser();
    try {
      const { w, h } = FORMATS['9:16'];
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await ctx.route('http://reel.local/**', async (route) => {
        const rel = decodeURIComponent(new URL(route.request().url()).pathname);
        const body = await readFile(join(bundle.dir, rel));
        await route.fulfill({ body, contentType: TYPES[extname(rel)] ?? 'application/octet-stream' });
      });
      await ctx.addInitScript((reel) => {
        (window as unknown as { REEL: unknown }).REEL = reel;
      }, input);
      const page = await ctx.newPage();
      await page.goto('http://reel.local/index.html');
      await page.evaluate(() => window.reelPage.ready());
      const cdp = await ctx.newCDPSession(page);
      const times = [...Array(FRAMES).keys()].map((i) => Math.round(((i + 0.5) / FRAMES) * spec.duration * 30) / 30);
      for (const t of times.slice(0, 12)) await page.evaluate((x) => window.reelPage.seek(x), t);
      await browser.startTracing(page, { categories: TRACE_CATEGORIES });
      const js: number[] = [];
      const wall: number[] = [];
      for (const [i, t] of times.entries()) {
        const t0 = performance.now();
        js.push(
          await page.evaluate(
            async ([i, t]) => {
              performance.mark(`f${i}`);
              const a = performance.now();
              await window.reelPage.seek(t); // includes the two-rAF paint barrier
              return performance.now() - a;
            },
            [i, t] as const,
          ),
        );
        await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
        wall.push(performance.now() - t0);
      }
      await page.evaluate((n) => performance.mark(`f${n}`), FRAMES);
      const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };
      out.push({ js, wall, b: attribute(trace.traceEvents, FRAMES, null) });
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
  return out;
}

// ---------- main ----------
await mkdir(OUT, { recursive: true });
const APPROACHES: Approach[] = (args.only?.split(',') as Approach[] | undefined) ?? ['none', 'prefix', 'dash', 'precompute', 'recompute', 'boil', 'boil-shift'];
const result: Record<string, unknown> = { frames: FRAMES, runs: RUNS, rect: RECT, viewport: `${W}×${H}`, launch: 'launchBrowser() GPU raster' };

// Real docs from the image spikes (out/sketch/S2, S3), when present: the chosen approaches per mode, one run each.
if (args.real) {
  const rows: Record<string, unknown>[] = [];
  const browser = await launchBrowser();
  for (const dir of ['S2', 'S3']) {
    const files = (await readdir(join(REPO, 'out/sketch', dir)).catch(() => [] as string[])).filter((f) => f.endsWith('.sketch.json')).sort();
    for (const f of files) {
      const doc = JSON.parse(await readFile(join(REPO, 'out/sketch', dir, f), 'utf8')) as SketchDoc;
      const bad = problems(doc);
      const pts = doc.strokes.reduce((n, s) => n + s.pts.length, 0);
      if (bad.length) {
        rows.push({ doc: `${dir}/${f}`, problems: bad });
        console.log(`${dir}/${f}: invalid (${bad[0]})`);
        continue;
      }
      const none = await measure(browser, 'none', null);
      for (const a of (doc.mode === 'line' ? ['dash', 'prefix'] : ['precompute', 'boil-shift']) as Approach[]) {
        const s = await measure(browser, a, null, doc);
        const row = {
          doc: `${dir}/${f}`,
          mode: doc.mode,
          strokes: doc.strokes.length,
          points: pts,
          approach: a,
          js: stats(s.js),
          overlayBusy: stats(s.b.map((b, i) => b.busy - none.b[i]!.busy)),
          raster: stats(s.b.map((b) => b.raster)),
        };
        rows.push(row);
        console.log(`${row.doc.padEnd(36)} ${doc.mode.padEnd(6)} ${String(row.strokes).padStart(3)} strokes ${String(pts).padStart(4)} pts ${a.padEnd(10)} js ${row.js.median}/${row.js.p95}  overlayBusy ${row.overlayBusy.median}/${row.overlayBusy.p95}  gpu-raster ${row.raster.median}/${row.raster.p95}`);
      }
    }
  }
  await browser.close();
  await writeFile(join(OUT, 'timings-real-docs.json'), JSON.stringify(rows, null, 1));
  process.exit(0);
}

if (args.discover) {
  const disc = new Map<string, number>();
  const browser = await launchBrowser();
  await measure(browser, 'precompute', disc);
  await browser.close();
  for (const [k, v] of [...disc].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${v.toFixed(1).padStart(8)} ms  ${k}`);
  process.exit(0);
}

type Row = { run: number } & Record<'js' | 'main' | 'style' | 'layout' | 'paint' | 'script' | 'raster' | 'wall' | 'busy' | 'overlay' | 'overlayBusy', Stat>;
const timing: Record<string, Row[]> = {};
for (let r = 0; r < RUNS; r++) {
  // one browser per run, approaches interleaved so machine load hits them alike
  const browser = await launchBrowser();
  const series = new Map<Approach, Series>();
  for (const a of APPROACHES) series.set(a, await measure(browser, a, null));
  await browser.close();
  const none = series.get('none');
  for (const [a, s] of series) {
    // overlay's own cost per frame: JS update + (main-thread style/layout/paint − the same frame index without overlay)
    const overlay = s.b.map((b, i) => s.js[i]! + Math.max(0, b.style + b.layout + b.paint - (none ? none.b[i]!.style + none.b[i]!.layout + none.b[i]!.paint : 0)));
    // and, catching everything the categories miss: main-thread busy − the same frame index without overlay
    const overlayBusy = s.b.map((b, i) => b.busy - (none ? none.b[i]!.busy : 0));
    (timing[a] ??= []).push({
      run: r,
      js: stats(s.js),
      script: stats(s.b.map((b) => b.script)),
      style: stats(s.b.map((b) => b.style)),
      layout: stats(s.b.map((b) => b.layout)),
      paint: stats(s.b.map((b) => b.paint)),
      main: stats(s.b.map((b) => b.main)),
      busy: stats(s.b.map((b) => b.busy)),
      raster: stats(s.b.map((b) => b.raster)),
      wall: stats(s.wall),
      overlay: stats(overlay),
      overlayBusy: stats(overlayBusy),
    });
    const last = timing[a]!.at(-1)!;
    console.log(
      `run ${r} ${a.padEnd(10)} js ${last.js.median}/${last.js.p95}  style ${last.style.median}/${last.style.p95}  layout ${last.layout.median}/${last.layout.p95}  paint ${last.paint.median}/${last.paint.p95}  busy ${last.busy.median}/${last.busy.p95}  gpu-raster ${last.raster.median}/${last.raster.p95}  overlay ${last.overlay.median}/${last.overlay.p95}  overlayBusy ${last.overlayBusy.median}/${last.overlayBusy.p95}  wall ${last.wall.median}/${last.wall.p95}`,
    );
  }
}
result.timing = timing;

if (!args.only) {
  if (!args['skip-dilemma']) {
    const d = await dilemma(RUNS);
    result.dilemma = d.map((s, run) => ({
      run,
      seekWithPaintBarrier: stats(s.js),
      script: stats(s.b.map((b) => b.script)),
      style: stats(s.b.map((b) => b.style)),
      layout: stats(s.b.map((b) => b.layout)),
      paint: stats(s.b.map((b) => b.paint)),
      main: stats(s.b.map((b) => b.main)),
      busy: stats(s.b.map((b) => b.busy)),
      raster: stats(s.b.map((b) => b.raster)),
      wall: stats(s.wall),
    }));
    for (const x of result.dilemma as { run: number; busy: Stat; raster: Stat; wall: Stat }[]) {
      console.log(`dilemma 9:16 run ${x.run}: busy ${x.busy.median}/${x.busy.p95}  gpu-raster ${x.raster.median}/${x.raster.p95}  wall ${x.wall.median}/${x.wall.p95}`);
    }
  }

  const order: Record<string, unknown> = {};
  for (const raster of ['gpu', 'cpu'] as const) {
    for (const a of ['prefix', 'dash', 'precompute', 'recompute', 'boil', 'boil-shift'] as const) {
      order[`${raster} ${a}`] = await orderCheck(raster, a);
      console.log(`seek order ${raster} ${a}: ${JSON.stringify(order[`${raster} ${a}`])}`);
    }
  }
  result.seekOrder = order;

  const layerOut: Record<string, unknown> = {};
  for (const a of ['none', 'dash', 'prefix', 'precompute'] as const) {
    layerOut[a] = await layers(a);
    console.log(`layers ${a}:`, JSON.stringify(layerOut[a], null, 1));
  }
  result.layers = layerOut;

  // contact sheet: both modes (both line approaches) at p = 0.1 / 0.4 / 0.7 / 1.0
  const cells: Cell[] = [];
  const browser = await launchBrowser();
  const o = await openStage(browser);
  for (const a of ['dash', 'prefix', 'precompute', 'boil-shift'] as const) {
    await mount(o, a);
    for (const p of [0.1, 0.4, 0.7, 1]) {
      await frame(o, 7000, p, tOf(p));
      const png = await shotPng(o, { x: 0, y: RECT.y - 300, width: W, height: RECT.h + 600 });
      cells.push({ label: `${a === 'dash' || a === 'prefix' ? 'line' : 'sketch'} · ${a} · p=${p}`, src: `data:image/png;base64,${png.toString('base64')}` });
    }
  }
  await o.close();
  await browser.close();
  await sheet(join(REPO, 'out/dev/sketch-spikes/s4-drawon.png'), cells, { cols: 4, cell: 340, title: 'S4 draw-on · 6000-point docs at 1080×1920 (crop around the overlay; text sits under the over mount)' });
}

await writeFile(join(OUT, args.only ? `timings-${args.only.replace(/,/g, '_')}.json` : 'timings.json'), JSON.stringify(result, null, 1));
console.log('done');
