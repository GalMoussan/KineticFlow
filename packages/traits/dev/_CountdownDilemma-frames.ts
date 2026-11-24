// Temp dev script (CountdownDilemma): mid-motion contact sheets at the style's own bpm.
import { spawn } from 'node:child_process';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FORMATS, JobSpec, formatSlug, type FormatId } from '@reel/core';
import { buildCueSheet } from '../../timing/src/index.ts';
import { RECIPES, recipe } from '../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../src/index.ts';
import { buildBundle } from '../../render/src/bundle.ts';
import { reelInput } from '../../render/src/reel-input.ts';
import { launchBrowser } from '../../render/src/capture.ts';

const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/dev');
const { values: args } = parseArgs({ options: { spec: { type: 'string' }, style: { type: 'string' }, formats: { type: 'string' }, name: { type: 'string' }, times: { type: 'string' }, every: { type: 'string' }, tw: { type: 'string' }, cols: { type: 'string' } } });
const specPath = resolve(args.spec!);
const specDir = dirname(specPath);
const raw = JSON.parse(await readFile(specPath, 'utf8'));
const rec = recipe(args.style!);
Object.assign(raw, { style: args.style, palette: rec.defaults.palette, fonts: { ...rec.defaults.fonts }, music: { source: 'preset', ...rec.defaults.music, seed: 1 } });
const spec = JobSpec.parse(raw);
const styles = resolveStyles(spec, RECIPES, TRAIT_META);
assertResolved(styles);
const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm: rec.defaults.music.bpm, fps: 30 });
const bundle = await buildBundle({ spec, specDir, outDir: join(OUT, `bundle-${args.name}`), traits: usedTraits(styles) });
const base = resolve(bundle.dir);
const server = createServer(async (req, res) => {
  const path = normalize(join(base, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
  try {
    if (!(await stat(path)).isFile()) throw new Error('nf');
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
let times: number[];
if (args.times) times = args.times.split(',').map(Number);
else if (args.every) {
  const [a, b, st] = args.every.split(':').map(Number) as [number, number, number];
  times = [];
  for (let t = a; t <= b + 1e-9; t += st) times.push(Math.round(t * 30) / 30);
} else {
  times = [];
  for (const s of sheet.sections) {
    const w = sheet.cues.find((c) => c.type === 'camera-move' && c.section === s.id);
    if (w) times.push(w.t + 0.05);
    for (const it of s.items) times.push(it.at - 0.1, it.at + 0.08);
    times.push(s.timing.holdEnd - 1 / 30);
  }
  times = times.map((t) => Math.round(t * 30) / 30);
}
console.log(sheet.sections.map((s) => `${s.id} in=${s.timing.in} lands=${s.items.map((i) => i.at).join(',')} out=${s.timing.out}`).join('\n'));
const browser = await launchBrowser({ raster: 'cpu' });
await mkdir(OUT, { recursive: true });
for (const fmt of (args.formats?.split(',') ?? ['9:16']) as FormatId[]) {
  const input = await reelInput({ spec, sheet, formatId: fmt, specDir, bundle, styles });
  const { w, h } = input.format;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => (m.type() === 'error' ? console.log('console', m.text()) : undefined));
  await page.addInitScript((reel) => {
    window.REEL = reel;
  }, input);
  await page.goto(`${url}/index.html`);
  await page.evaluate(() => window.reelPage.ready());
  const cdp = await ctx.newCDPSession(page);
  const pngs: Buffer[] = [];
  for (const t of times) {
    await page.evaluate((tt) => window.reelPage.seek(tt), t);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    pngs.push(Buffer.from(data, 'base64'));
  }
  const { safe } = FORMATS[fmt];
  const cols = Number(args.cols ?? 8), rows = Math.ceil(pngs.length / cols), tw = Number(args.tw ?? 300), th = Math.round((h * tw) / w);
  const sx = tw / w, sy = th / h;
  const box = `drawbox=x=${Math.round(safe.left * sx)}:y=${Math.round(safe.top * sy)}:w=${Math.round((w - safe.left - safe.right) * sx)}:h=${Math.round((h - safe.top - safe.bottom) * sy)}:color=red@0.5:t=1`;
  const vf = `scale=${tw}:${th},${box},tile=${cols}x${rows}`;
  const path = join(OUT, `${args.name}-frames-${formatSlug(fmt)}.png`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', vf, '-frames:v', '1', path], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (const p of pngs) ff.stdin.write(p);
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`${fmt}: ${times.map((t, i) => `${i}:${t.toFixed(2)}`).join(' ')}\n→ ${path}`);
  await ctx.close();
}
await browser.close();
server.close();
