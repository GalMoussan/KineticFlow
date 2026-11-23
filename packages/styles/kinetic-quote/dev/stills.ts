/**
 * Dev harness for the kinetic-quote engine: builds the bundle for `examples/dilemma.json`, renders stills for 9:16
 * and 1:1 into contact sheets, checks content boxes against the safe area, prints fingerprints (and which windows a
 * date-only edit changes), and runs the determinism checks.
 *
 *   node packages/styles/kinetic-quote/dev/stills.ts [--spec path] [--date YYYY-MM-DD]
 *
 * Writes `out/dev/kq-9x16.png`, `out/dev/kq-1x1.png` (stills left→right, top→bottom in the printed order) and
 * `out/dev/fp-*.json`.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FORMATS, JobSpec, formatSlug, type CueSheet, type FormatId, type ReelInput, type TextBox } from '@reel/core';
import { buildCueSheet } from '../../../timing/src/index.ts';
import { recipe } from '../../src/index.ts';
import { buildBundle, type Bundle } from '../../../render/src/bundle.ts';
import { reelInput } from '../../../render/src/reel-input.ts';
import type { Browser, CDPSession, Page } from 'playwright';
import type * as Playwright from 'playwright';
import type * as PngJs from 'pngjs';

// Playwright and pngjs are dependencies of @reel/render and are not resolvable from this folder, so they are
// resolved from that package and imported by path (a static import cannot express that).
const fromRender = createRequire(new URL('../../../render/package.json', import.meta.url));
const { chromium } = fromRender('playwright') as typeof Playwright;
const { PNG } = fromRender('pngjs') as typeof PngJs;

const REPO = new URL('../../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/dev');
const { values: args } = parseArgs({ options: { spec: { type: 'string' }, date: { type: 'string' } } });
const specPath = resolve(args.spec ?? join(REPO, 'examples/dilemma.json'));
const specDir = dirname(specPath);
const ALT_DATE = args.date ?? '2026-12-03';

// ---------- server (CSP from spikes/lib.ts) ----------
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; media-src 'self' blob:";
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
};
async function serve(root: string): Promise<{ url: string; close(): Promise<void> }> {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const path = normalize(join(base, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
    if (!path.startsWith(base)) return void res.writeHead(403).end();
    try {
      if (!(await stat(path)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}

const GPU_ARGS = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'];
const launch = () => chromium.launch({ headless: true, args: GPU_ARGS });

// ---------- page ----------
const problems: string[] = [];
interface Opened { page: Page; cdp: CDPSession; close(): Promise<void> }
async function open(browser: Browser, url: string, input: ReelInput): Promise<Opened> {
  const { w, h } = input.format;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${input.format.id}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${input.format.id}] console.${m.type()}: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`[${input.format.id}] request failed: ${r.url()}`));
  await page.addInitScript((reel) => {
    window.REEL = reel;
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  }, input);
  await page.goto(`${url}/index.html`);
  await page.evaluate(() => window.reelPage.ready());
  const cdp = await ctx.newCDPSession(page);
  return { page, cdp, close: () => ctx.close() };
}

async function shot(o: Opened, t: number): Promise<Buffer> {
  await o.page.evaluate((tt) => window.reelPage.seek(tt), t);
  const { data } = await o.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  return Buffer.from(data, 'base64');
}

function maxDelta(a: Buffer, b: Buffer): { max: number; at: string; count: number } {
  const ia = PNG.sync.read(a), ib = PNG.sync.read(b);
  const pa = ia.data, pb = ib.data;
  if (pa.length !== pb.length) return { max: 255, at: 'size', count: 0 };
  let m = 0, at = '', count = 0;
  for (let i = 0; i < pa.length; i++) {
    const d = Math.abs(pa[i]! - pb[i]!);
    if (d) count++;
    if (d > m) {
      m = d;
      at = `${(i >> 2) % ia.width},${Math.floor((i >> 2) / ia.width)}`;
    }
  }
  return { max: m, at, count };
}

/** Tiles PNG stills into one sheet with ffmpeg (safe area drawn in red); no frame files. */
async function contactSheet(pngs: Buffer[], fmt: FormatId, path: string): Promise<void> {
  const { w, h, safe } = FORMATS[fmt];
  const cols = 6, rows = Math.ceil(pngs.length / cols), tw = 360, th = Math.round((h * tw) / w);
  const vf = [
    `drawbox=x=${safe.left}:y=${safe.top}:w=${w - safe.left - safe.right}:h=${h - safe.top - safe.bottom}:color=red@0.6:t=3`,
    `scale=${tw}:${th}:flags=lanczos`,
    `pad=${tw + 8}:${th + 8}:4:4:white`,
    `tile=${cols}x${rows}`,
  ].join(',');
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', vf, '-frames:v', '1', path], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  for (const p of pngs) ff.stdin.write(p);
  ff.stdin.end();
  const done = Promise.withResolvers<void>();
  ff.on('close', (code) => (code === 0 ? done.resolve() : done.reject(new Error(`ffmpeg exited ${code}`))));
  await done.promise;
}

function stillTimes(sheet: CueSheet): { t: number; label: string }[] {
  const out = sheet.sections.map((s) => ({ t: Math.round((s.timing.holdEnd - 1 / 30) * 30) / 30, label: `${s.id} hold` }));
  const moves = sheet.cues.filter((c) => c.type === 'camera-move');
  for (const i of [0, Math.floor(moves.length / 2), moves.length - 1]) {
    const m = moves[i]!;
    out.push({ t: Math.round(((m.t + m.until!) / 2) * 30) / 30, label: `move→${m.section}` });
  }
  const intro = sheet.cues.find((c) => c.type === 'intro');
  if (intro) out.push({ t: intro.t, label: 'intro' });
  return out;
}

const inside = (b: TextBox, fmt: FormatId) => {
  const { w, h, safe } = FORMATS[fmt];
  return b.x >= safe.left && b.y >= safe.top && b.x + b.w <= w - safe.right && b.y + b.h <= h - safe.bottom;
};
const overlaps = (a: TextBox, b: TextBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const WINDOWS: [number, number][] = [[0, 10], [10, 20], [20, 26]];
const fpHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// ---------- main ----------
await mkdir(OUT, { recursive: true });
const raw = JSON.parse(await readFile(specPath, 'utf8'));
const spec = JobSpec.parse(raw);
const altSpec = JobSpec.parse({
  ...raw,
  sections: raw.sections.map((s: { role: string }) => (s.role === 'datetime' ? { ...s, date: ALT_DATE } : s)),
});
const styleId = typeof spec.style === 'string' ? spec.style : spec.style.base;
const rec = recipe(styleId);
const cue = (s: JobSpec) => buildCueSheet({ spec: s, choreography: rec.choreography, bpm: rec.defaults.music.bpm, fps: 30 });
const sheet = cue(spec);
const altSheet = cue(altSpec);
const bundle: Bundle = await buildBundle({ styleId, spec, specDir, outDir: join(OUT, 'bundle') });
const altBundle = await buildBundle({ styleId, spec: altSpec, specDir, outDir: join(OUT, 'bundle') });
if (altBundle.hash !== bundle.hash) problems.push('bundle hash depends on the date (it must not)');
console.log(`bundle ${bundle.hash.slice(0, 16)} → ${bundle.dir}`);

const srv = await serve(bundle.dir);
let browser = await launch();
let safeFailures = 0, overlapFailures = 0;
const formats = spec.formats;
for (const fmt of formats) {
  const input = await reelInput({ spec, sheet, formatId: fmt, specDir, bundle });
  const o = await open(browser, srv.url, input);
  const times = stillTimes(sheet);
  const pngs: Buffer[] = [];
  console.log(`\n== ${fmt} stills ==`);
  for (const [i, s] of times.entries()) {
    pngs.push(await shot(o, s.t));
    const boxes: TextBox[] = await o.page.evaluate(() => window.reelPage.boxes());
    const isHold = s.label.endsWith('hold');
    const bad = boxes.filter((b) => !inside(b, fmt));
    const ov = boxes.flatMap((a, j) => boxes.slice(j + 1).filter((b) => overlaps(a, b)).map((b) => `${a.text}×${b.text}`));
    if (isHold) {
      safeFailures += bad.length;
      overlapFailures += ov.length;
    }
    console.log(
      `#${i} t=${s.t.toFixed(3)} ${s.label}: ${boxes.length} boxes` +
        (bad.length ? ` OUTSIDE SAFE: ${bad.map((b) => `${b.section}/${b.unit} "${b.text}" [${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.w.toFixed(0)}×${b.h.toFixed(0)}]`).join('; ')}` : ' all inside safe') +
        (ov.length ? ` OVERLAPS: ${ov.join(', ')}` : ''),
    );
    if (isHold) for (const b of boxes) console.log(`    ${b.section}/${b.unit} "${b.text}" x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} w=${b.w.toFixed(0)} h=${b.h.toFixed(0)}`);
  }
  const sheetPath = join(OUT, `kq-${formatSlug(fmt)}.png`);
  await contactSheet(pngs, fmt, sheetPath);
  console.log(`contact sheet → ${sheetPath}`);

  // Fingerprints: base vs date-changed spec.
  const altInput = await reelInput({ spec: altSpec, sheet: altSheet, formatId: fmt, specDir, bundle: altBundle });
  const alt = await open(browser, srv.url, altInput);
  for (const [t0, t1] of WINDOWS) {
    const a = await o.page.evaluate(([x, y]) => window.reelPage.fingerprint(x, y), [t0, t1] as const);
    const b = await alt.page.evaluate(([x, y]) => window.reelPage.fingerprint(x, y), [t0, t1] as const);
    await writeFile(join(OUT, `fp-${formatSlug(fmt)}-${t0}-${t1}.json`), JSON.stringify(a, null, 1));
    await writeFile(join(OUT, `fp-${formatSlug(fmt)}-${t0}-${t1}-alt.json`), JSON.stringify(b, null, 1));
    console.log(`fingerprint [${t0}, ${t1}) ${fpHash(a)}  date=${ALT_DATE}: ${fpHash(b)}  ${fpHash(a) === fpHash(b) ? 'unchanged' : 'CHANGED'}`);
  }
  await alt.close();

  // Determinism (a): 5 frames forward then reverse in one page, max Δ ≤ 2/255.
  const det = [0.5, 4.4, 9.8, 14.3, 22.7];
  const fwd: Buffer[] = [];
  for (const t of det) fwd.push(await shot(o, t));
  let worst = 0;
  for (const [i, t] of [...det.entries()].reverse()) {
    const d = maxDelta(fwd[i]!, await shot(o, t));
    if (d.max) console.log(`  t=${t}: max Δ ${d.max} at ${d.at}, ${d.count} channel values differ`);
    worst = Math.max(worst, d.max);
  }
  console.log(`determinism forward/reverse: max Δ ${worst}/255 ${worst <= 2 ? 'ok' : 'FAIL'}`);
  if (worst > 2) problems.push(`[${fmt}] forward/reverse max Δ ${worst}/255`);
  await o.close();

  // Determinism (b): the same frames in the same order in two fresh browsers must be identical.
  const runs: string[][] = [];
  for (let r = 0; r < 2; r++) {
    await browser.close();
    browser = await launch();
    const p = await open(browser, srv.url, input);
    const hashes: string[] = [];
    for (const t of det) hashes.push(createHash('sha256').update(await shot(p, t)).digest('hex'));
    runs.push(hashes);
    await p.close();
  }
  const same = runs[0]!.every((h, i) => h === runs[1]![i]);
  console.log(`determinism fresh launches: ${same ? 'identical' : 'DIFFERENT'}`);
  if (!same) problems.push(`[${fmt}] fresh-launch frames differ`);
}
await browser.close();
await srv.close();

console.log(`\nsafe-area failures at holds: ${safeFailures}; overlaps at holds: ${overlapFailures}`);
if (problems.length) {
  console.log(`problems (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exitCode = 1;
} else console.log('no page errors, no CSP violations');
