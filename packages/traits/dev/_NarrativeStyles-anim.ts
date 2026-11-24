/** Temp (NarrativeStyles): mid-motion contact sheet. node … --spec x --style id [--format 9:16] [--name n] [--sections 0,1] [--offs -0.1,0.1,0.3,0.6] */
import { spawn } from 'node:child_process';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FORMATS, JobSpec, type FormatId } from '@reel/core';
import { buildCueSheet } from '../../timing/src/index.ts';
import { RECIPES, recipe } from '../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../src/index.ts';
import { buildBundle } from '../../render/src/bundle.ts';
import { reelInput } from '../../render/src/reel-input.ts';
import { launchBrowser } from '../../render/src/capture.ts';

const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/dev');
const { values: a } = parseArgs({ options: { spec: { type: 'string' }, style: { type: 'string' }, format: { type: 'string' }, name: { type: 'string' }, sections: { type: 'string' }, offs: { type: 'string' }, times: { type: 'string' } } });
const specPath = resolve(a.spec!);
const raw = JSON.parse(await readFile(specPath, 'utf8'));
const d = recipe(a.style!).defaults;
Object.assign(raw, { style: a.style, palette: d.palette, fonts: { ...d.fonts }, music: { source: 'preset', ...d.music, seed: 1 } });
const spec = JobSpec.parse(raw);
const styles = resolveStyles(spec, RECIPES, TRAIT_META);
assertResolved(styles);
const rec = recipe(styles.job.recipe);
const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm: d.music.bpm, fps: 30 });
const fmt = (a.format ?? '9:16') as FormatId;
const NAME = a.name ?? `_nar-anim-${a.style}`;
const bundle = await buildBundle({ spec, specDir: dirname(specPath), outDir: join(OUT, `bundle-${NAME}`), traits: usedTraits(styles) });
const base = resolve(bundle.dir);
const server = createServer(async (req, res) => {
  const path = normalize(join(base, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
  try {
    if (!(await stat(path)).isFile()) throw new Error('nf');
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await launchBrowser({ raster: 'cpu' });
const input = await reelInput({ spec, sheet, formatId: fmt, specDir: dirname(specPath), bundle, styles });
const { w, h, safe } = FORMATS[fmt];
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript((reel) => { window.REEL = reel; }, input);
await page.goto(`${url}/index.html`);
await page.evaluate(() => window.reelPage.ready());
const cdp = await ctx.newCDPSession(page);
const offs = (a.offs ?? '-0.1,0.15,0.4,0.8').split(',').map(Number);
const secIdx = a.sections ? a.sections.split(',').map(Number) : sheet.sections.map((_, i) => i);
const times = a.times ? a.times.split(',').map(Number) : secIdx.flatMap((i) => offs.map((o) => sheet.sections[i]!.timing.firstLand + o));
console.log(sheet.sections.map((s) => `${s.id} in ${s.timing.in.toFixed(2)} first ${s.timing.firstLand.toFixed(2)} last ${s.timing.lastLand.toFixed(2)} out ${s.timing.out.toFixed(2)}`).join('\n'));
const pngs: Buffer[] = [];
for (const t of times) {
  await page.evaluate((tt) => window.reelPage.seek(tt), t);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  pngs.push(Buffer.from(data, 'base64'));
}
const cols = Math.min(times.length, offs.length > 1 && !a.times ? offs.length : 6), rows = Math.ceil(pngs.length / cols), tw = fmt === '16:9' ? 480 : 300, th = Math.round((h * tw) / w);
const vf = [`drawbox=x=${safe.left}:y=${safe.top}:w=${w - safe.left - safe.right}:h=${h - safe.top - safe.bottom}:color=red@0.5:t=2`, `scale=${tw}:${th}:flags=lanczos`, `pad=${tw + 6}:${th + 6}:3:3:white`, `tile=${cols}x${rows}`].join(',');
await mkdir(OUT, { recursive: true });
const path = join(OUT, `${NAME}-${fmt.replace(':', 'x')}.png`);
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', vf, '-frames:v', '1', path], { stdio: ['pipe', 'inherit', 'inherit'] });
for (const p of pngs) ff.stdin.write(p);
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log('sheet →', path, 'times', times.map((t) => t.toFixed(2)).join(' '));
await browser.close();
server.close();
