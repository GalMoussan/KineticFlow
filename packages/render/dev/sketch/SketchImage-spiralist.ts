/**
 * S2 spike: spiralist line art (matisse) and freeline contour → one-stroke SketchDocs.
 *
 * Serves the vendored spiralist tree (ONNX + wasm are symlinks to /tmp/spiralist),
 * runs both engines in headless Chromium on the wasm/CPU backend, twice, and checks
 * the JSON sha256. Prints a timing JSON object to stdout.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { problems, type SketchDoc } from './doc.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../../..');
const vendor = join(here, 'vendor/spiralist');
const imagesDir = join(root, 'out/sketch/images');
const outDir = join(root, 'out/sketch/S2');

const IMAGES = [
  { id: 'logo', file: 'logo.png' },
  { id: 'portrait', file: 'portrait.jpg' },
  { id: 'product', file: 'product.jpg' },
  { id: 'drawing', file: 'drawing.jpg' },
  { id: 'landscape', file: 'landscape.jpg' },
] as const;

/**
 * Native spiralist controls that made each image look its best in the `--sweep` grid
 * (matisse 0.3/0.5/0.7/0.9 × contour rings 30/50/80/110, judged by eye on a contact sheet).
 * `detail` is the SketchDoc 1–5 level the matisse slider corresponds to (0.3→2 … 0.9→5).
 */
const CHOICE: Record<(typeof IMAGES)[number]['id'], { matisseDetail: number; contourRings: number; detail: 1 | 2 | 3 | 4 | 5 }> = {
  logo: { matisseDetail: 0.7, contourRings: 80, detail: 4 },
  portrait: { matisseDetail: 0.7, contourRings: 50, detail: 4 },
  product: { matisseDetail: 0.7, contourRings: 50, detail: 4 },
  drawing: { matisseDetail: 0.9, contourRings: 80, detail: 5 },
  landscape: { matisseDetail: 0.9, contourRings: 50, detail: 5 },
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.task': 'application/octet-stream',
};

interface EnginePayload {
  pts: [number, number][];
  box: [number, number];
  info: Record<string, number | string | boolean | null>;
}

interface SpikePayload {
  width: number;
  height: number;
  matisse: EnginePayload;
  contour: EnginePayload;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function canon(doc: SketchDoc): string {
  const body = {
    v: 1 as const,
    box: doc.box,
    mode: doc.mode,
    strokes: doc.strokes.map((s) => {
      const stroke: { pts: [number, number][]; w?: number; closed?: boolean } = {
        pts: s.pts.map((p) => [p[0], p[1]] as [number, number]),
      };
      if (s.w != null) stroke.w = s.w;
      if (s.closed) stroke.closed = true;
      return stroke;
    }),
    meta: {
      source: doc.meta.source,
      imageHash: doc.meta.imageHash,
      provider: doc.meta.provider,
      model: doc.meta.model,
      detail: doc.meta.detail,
      seed: doc.meta.seed,
      version: doc.meta.version,
    },
  };
  return JSON.stringify(body, null, 2) + '\n';
}

function asDoc(kind: 'matisse' | 'contour', payload: EnginePayload, imageHash: string, detail: 1 | 2 | 3 | 4 | 5, native: string): SketchDoc {
  if (payload.pts.length < 2) throw new Error(`${kind} produced ${payload.pts.length} points`);
  if (payload.pts.length > 6000) throw new Error(`${kind} has ${payload.pts.length} points`);
  const doc: SketchDoc = {
    v: 1,
    box: payload.box,
    mode: 'line',
    strokes: [{ pts: payload.pts, w: 1.2 }],
    meta: {
      source: 'image',
      imageHash,
      provider: 'spiralist',
      model: kind === 'matisse' ? 'spiralist-matisse' : 'spiralist-contour',
      detail,
      seed: 1,
      version: native,
    },
  };
  const bad = problems(doc);
  if (bad.length) throw new Error(`${kind} invalid: ${bad.join('; ')}`);
  return doc;
}

async function serve(dir: string): Promise<{ port: number; close: () => Promise<void> }> {
  const rootDir = resolve(dir);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // pathname is absolute (`/spike.html`). path.join would treat that as a reset
    // and serve from the filesystem root, so strip the leading slashes first.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'spike.html';
    const path = normalize(join(rootDir, rel));
    if (path !== rootDir && !path.startsWith(rootDir + '/')) {
      res.writeHead(403);
      res.end();
      return;
    }
    const stream = createReadStream(path);
    stream.on('open', () => {
      res.writeHead(200, {
        'content-type': MIME[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      stream.pipe(res);
    });
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

async function openPage(browser: Browser, port: number): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultTimeout(240_000);
  const logs: string[] = [];
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push(`console: ${msg.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/spike.html`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => (window as unknown as { __spikeReady?: boolean }).__spikeReady === true, null, { timeout: 30_000 });
  } catch (err) {
    throw new Error(`harness did not start: ${(err as Error).message}\n${logs.slice(-20).join('\n')}`);
  }
  const boot = await page.evaluate(() => (window as unknown as { __spikeError?: string }).__spikeError ?? '');
  if (boot) throw new Error(boot + '\n' + logs.slice(-20).join('\n'));
  (page as Page & { __logs?: string[] }).__logs = logs;
  return page;
}

async function runPass(browser: Browser, port: number, write: boolean): Promise<Record<string, unknown>[]> {
  const page = await openPage(browser, port);
  const rows: Record<string, unknown>[] = [];
  try {
    for (const image of IMAGES) {
      const file = join(imagesDir, image.file);
      const bytes = await readFile(file);
      const choice = CHOICE[image.id];
      const imageHash = sha256(bytes);
      const dataUrl = `data:${image.file.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`;
      const started = Date.now();
      let payload: SpikePayload;
      try {
        payload = await page.evaluate(async (opts) => {
          const run = (window as unknown as { runSpike: (o: typeof opts) => Promise<SpikePayload> }).runSpike;
          return run(opts);
        }, { dataUrl, seed: 1, matisseDetail: choice.matisseDetail, contourRings: choice.contourRings });
      } catch (err) {
        const logs = (page as Page & { __logs?: string[] }).__logs ?? [];
        throw new Error(`${image.id} failed: ${(err as Error).message}\n${logs.slice(-12).join('\n')}`);
      }
      const wallMs = Date.now() - started;
      const matisse = asDoc('matisse', payload.matisse, imageHash, choice.detail, `s2-matisse-${choice.matisseDetail}`);
      const contour = asDoc('contour', payload.contour, imageHash, choice.detail, `s2-contour-r${choice.contourRings}`);
      const matisseText = canon(matisse);
      const contourText = canon(contour);
      if (write) {
        await writeFile(join(outDir, `${image.id}-matisse.sketch.json`), matisseText);
        await writeFile(join(outDir, `${image.id}-contour.sketch.json`), contourText);
      }
      rows.push({
        image: image.id,
        wallMs,
        matisse: { ...payload.matisse.info, points: matisse.strokes[0]!.pts.length, sha256: sha256(Buffer.from(matisseText)), box: matisse.box },
        contour: { ...payload.contour.info, points: contour.strokes[0]!.pts.length, sha256: sha256(Buffer.from(contourText)), box: contour.box },
      });
      console.error(`${image.id} wall ${wallMs} ms  matisse ${matisse.strokes[0]!.pts.length} pts  contour ${contour.strokes[0]!.pts.length} pts`);
    }
  } finally {
    await page.close();
  }
  return rows;
}

/** `--sweep <dir>`: each image at several matisse details / contour ring counts, to pick CHOICE. */
async function sweep(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const httpd = await serve(vendor);
  const browser = await chromium.launch({ headless: true, args: ['--disable-webgpu', '--disable-gpu'] });
  try {
    const page = await openPage(browser, httpd.port);
    const grid = [
      { matisseDetail: 0.3, contourRings: 30 },
      { matisseDetail: 0.5, contourRings: 50 },
      { matisseDetail: 0.7, contourRings: 80 },
      { matisseDetail: 0.9, contourRings: 110 },
    ];
    for (const image of IMAGES) {
      const bytes = await readFile(join(imagesDir, image.file));
      const hash = sha256(bytes);
      const dataUrl = `data:${image.file.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`;
      for (const g of grid) {
        const payload = await page.evaluate(async (opts) => {
          // spike.html installs runSpike on window; the page global has no TS declaration.
          const host = window as unknown as { runSpike: (o: typeof opts) => Promise<SpikePayload> };
          return host.runSpike(opts);
        }, { dataUrl, seed: 1, ...g });
        await writeFile(join(dir, `${image.id}-m${g.matisseDetail}.json`), canon(asDoc('matisse', payload.matisse, hash, 3, `m${g.matisseDetail}`)));
        await writeFile(join(dir, `${image.id}-c${g.contourRings}.json`), canon(asDoc('contour', payload.contour, hash, 3, `c${g.contourRings}`)));
        console.error(`${image.id} m${g.matisseDetail} c${g.contourRings}`);
      }
    }
  } finally {
    await browser.close();
    await httpd.close();
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const httpd = await serve(vendor);
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-webgpu', '--disable-gpu'],
  });
  try {
    console.error(`spiralist server http://127.0.0.1:${httpd.port}`);
    const first = await runPass(browser, httpd.port, true);
    // A fresh browser drops the wasm session and the line cache, so the second
    // pass is a real rerun rather than a memoised geometry.
    const browser2 = await chromium.launch({ headless: true, args: ['--disable-webgpu', '--disable-gpu'] });
    let second: Record<string, unknown>[];
    try {
      second = await runPass(browser2, httpd.port, false);
    } finally {
      await browser2.close();
    }
    const mismatches: string[] = [];
    for (let i = 0; i < first.length; i++) {
      const a = first[i] as { image: string; matisse: { sha256: string }; contour: { sha256: string } };
      const b = second[i] as { image: string; matisse: { sha256: string }; contour: { sha256: string } };
      if (a.matisse.sha256 !== b.matisse.sha256) mismatches.push(`${a.image} matisse`);
      if (a.contour.sha256 !== b.contour.sha256) mismatches.push(`${a.image} contour`);
    }
    const report = { deterministic: mismatches.length === 0, mismatches, first, secondWallMs: second.map((r) => ({ image: (r as { image: string }).image, wallMs: (r as { wallMs: number }).wallMs })) };
    await writeFile(join(outDir, 'spiralist-timings.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ deterministic: report.deterministic, mismatches, images: first.map((r) => ({ image: (r as { image: string }).image, wallMs: (r as { wallMs: number }).wallMs })) }));
    if (mismatches.length) process.exitCode = 2;
  } finally {
    await browser.close();
    await httpd.close();
  }
}

const sweepAt = process.argv.indexOf('--sweep');
if (sweepAt >= 0) await sweep(resolve(process.argv[sweepAt + 1] ?? '/tmp/spiralist-sweep'));
else await main();
