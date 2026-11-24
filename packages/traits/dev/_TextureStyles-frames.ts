/**
 * Temporary (TextureStyles): full-size frames and a motion strip for one style.
 *   node packages/traits/dev/_TextureStyles-frames.ts --style id [--spec p] [--format 9:16] [--times 1,2.5] [--strip t0:t1:n]
 */
import { spawn } from 'node:child_process';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JobSpec, type FormatId } from '@reel/core';
import { buildCueSheet } from '../../timing/src/index.ts';
import { RECIPES, recipe } from '../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../src/index.ts';
import { buildBundle } from '../../render/src/bundle.ts';
import { reelInput } from '../../render/src/reel-input.ts';
import { launchBrowser } from '../../render/src/capture.ts';

const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/dev/_tex');
const { values: args } = parseArgs({
  options: { spec: { type: 'string' }, style: { type: 'string' }, format: { type: 'string' }, times: { type: 'string' }, strip: { type: 'string' }, gpu: { type: 'boolean' } },
});
const specPath = resolve(args.spec ?? join(REPO, 'examples/test-set/event-he.json'));
const fmt = (args.format ?? '9:16') as FormatId;
const raw = JSON.parse(await readFile(specPath, 'utf8'));
const d = recipe(args.style!).defaults;
Object.assign(raw, { style: args.style, palette: d.palette, fonts: { ...d.fonts } });
const spec = JobSpec.parse(raw);
const styles = resolveStyles(spec, RECIPES, TRAIT_META);
assertResolved(styles);
const rec = recipe(styles.job.recipe);
const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm: rec.defaults.music.bpm, fps: 30 });
const bundle = await buildBundle({ spec, specDir: dirname(specPath), outDir: join(OUT, `bundle-${args.style}`), traits: usedTraits(styles) });
const base = resolve(bundle.dir);
const server = createServer(async (req, res) => {
  const path = normalize(join(base, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
  try {
    if (!(await stat(path)).isFile()) throw new Error('nf');
    const T: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': T[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const browser = await launchBrowser({ raster: args.gpu ? 'gpu' : 'cpu' });
const input = await reelInput({ spec, sheet, formatId: fmt, specDir: dirname(specPath), bundle, styles });
const ctx = await browser.newContext({ viewport: { width: input.format.w, height: input.format.h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console.error', m.text()));
await page.addInitScript((reel) => void (window.REEL = reel), input);
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.evaluate(() => window.reelPage.ready());
const cdp = await ctx.newCDPSession(page);
const shot = async (t: number) => {
  await page.evaluate((tt) => window.reelPage.seek(tt), t);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(data, 'base64');
};
await mkdir(OUT, { recursive: true });
for (const s of sheet.sections) console.log(s.id, 'in', s.timing.in.toFixed(2), 'hold', s.timing.holdStart.toFixed(2), '–', s.timing.holdEnd.toFixed(2), 'out', s.timing.out.toFixed(2));
for (const t of (args.times ?? '').split(',').filter(Boolean).map(Number)) {
  const p = join(OUT, `${args.style}-${fmt.replace(':', 'x')}-${t}.png`);
  await writeFile(p, await shot(t));
  console.log('frame', p);
}
if (args.strip) {
  const [a, b, n] = args.strip.split(':').map(Number) as [number, number, number];
  const pngs: Buffer[] = [];
  for (let i = 0; i < n; i++) pngs.push(await shot(a + ((b - a) * i) / Math.max(1, n - 1)));
  const cols = Math.min(n, 6);
  const tw = 360;
  const th = Math.round((input.format.h * tw) / input.format.w);
  const p = join(OUT, `${args.style}-${fmt.replace(':', 'x')}-strip-${a}-${b}.png`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', `scale=${tw}:${th},pad=${tw + 6}:${th + 6}:3:3:white,tile=${cols}x${Math.ceil(n / cols)}`, '-frames:v', '1', p], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (const x of pngs) ff.stdin.write(x);
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('strip', p);
}
await browser.close();
server.close();
