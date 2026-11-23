/**
 * Evidence for `rhythm: audio-reactive` / `bass-pulse`: renders the spec's music (or decodes its track) exactly as
 * the renderer does (`prepareMusic`, envelopes over the whole stem), then
 *
 * - `out/dev/bass-pulse-sheet.png`: per section, the hold frame with the strongest bass (top row, "on a kick") and
 *   the weakest (bottom row, "between kicks"); the printed hero box sizes show the scale following the bass;
 * - `out/dev/bass-pulse-envelopes.png`: the music's waveform with the five band envelopes, beats and downbeats over
 *   the whole video (top) and a 4 s zoom (bottom).
 *
 *   node packages/traits/dev/bass-pulse.ts [--spec examples/m3-reactive/bass-pulse.json] [--format 9:16] [--name bass-pulse]
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BANDS, FORMATS, JobSpec, type CueSheet, type FormatId } from '@reel/core';
import type { Stereo } from '../../audio/src/types.ts';
import { RECIPES, recipe } from '../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../src/index.ts';
import { buildBundle } from '../../render/src/bundle.ts';
import { reelInput } from '../../render/src/reel-input.ts';
import { launchBrowser, ReelTab } from '../../render/src/capture.ts';
import { serveDir } from '../../render/src/server.ts';
import { prepareMusic } from '../../render/src/audio.ts';
import { nodeSampleBank } from '../../render/src/samples.ts';

const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/dev');
const { values: args } = parseArgs({ options: { spec: { type: 'string' }, format: { type: 'string' }, name: { type: 'string' } } });
const specPath = resolve(args.spec ?? join(REPO, 'examples/m3-reactive/bass-pulse.json'));
const specDir = dirname(specPath);
const fmt = (args.format ?? '9:16') as FormatId;
const NAME = args.name ?? 'bass-pulse';

/** Tiles PNGs `cols` wide with ffmpeg (no frame files). */
async function tile(pngs: Buffer[], cols: number, w: number, h: number, path: string): Promise<void> {
  const tw = 300;
  const th = Math.round((h * tw) / w);
  const vf = `scale=${tw}:${th}:flags=lanczos,pad=${tw + 8}:${th + 8}:4:4:white,tile=${cols}x${Math.ceil(pngs.length / cols)}`;
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-vf', vf, '-frames:v', '1', path], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  for (const p of pngs) ff.stdin.write(p);
  ff.stdin.end();
  const done = Promise.withResolvers<void>();
  ff.on('close', (code) => (code === 0 ? done.resolve() : done.reject(new Error(`ffmpeg exited ${code}`))));
  await done.promise;
}

/** Waveform min/max per pixel column of the mono mix over [t0, t1). */
function peaks(x: Stereo, t0: number, t1: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  const a = Math.floor(t0 * x.sampleRate);
  const n = Math.floor((t1 - t0) * x.sampleRate);
  for (let c = 0; c < cols; c++) {
    let lo = 0;
    let hi = 0;
    for (let i = a + Math.floor((c * n) / cols); i < a + Math.floor(((c + 1) * n) / cols) && i < x.l.length; i++) {
      const v = (x.l[i]! + x.r[i]!) / 2;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out.push([lo, hi]);
  }
  return out;
}

/** Draws waveform + envelopes in a page canvas and returns the PNG. */
async function plot(sheet: CueSheet, music: Stereo, zoom: [number, number]): Promise<Buffer> {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const W = 1500;
  const panels = [
    { t0: 0, t1: sheet.duration, wave: peaks(music, 0, sheet.duration, W) },
    { t0: zoom[0], t1: zoom[1], wave: peaks(music, zoom[0], zoom[1], W) },
  ];
  const data = { panels, env: sheet.envelopes, fps: sheet.fps, beats: sheet.beats, downbeats: sheet.downbeats, bands: BANDS };
  const png = await page.evaluate((d) => {
    const cv = document.createElement('canvas');
    cv.width = 1600;
    cv.height = 1000;
    document.body.appendChild(cv);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 1600, 1000);
    const colors: Record<string, string> = { sub: '#5b2a86', bass: '#e5007e', mid: '#2a8c8c', high: '#f0a000', onset: '#333' };
    d.panels.forEach((p, pi) => {
      const top = 20 + pi * 490;
      const x0 = 80;
      const X = (t: number) => x0 + ((t - p.t0) / (p.t1 - p.t0)) * 1500;
      g.fillStyle = '#000';
      g.font = '15px sans-serif';
      g.fillText(`${pi ? 'zoom' : 'full'} ${p.t0.toFixed(1)}–${p.t1.toFixed(1)} s`, 8, top + 14);
      // waveform
      const wy = top + 70;
      g.fillStyle = '#9aa';
      p.wave.forEach(([lo, hi], c) => g.fillRect(x0 + c, wy - hi * 60, 1, Math.max(1, (hi - lo) * 60)));
      // beats / downbeats
      for (const b of d.beats) if (b >= p.t0 && b <= p.t1) {
        const down = d.downbeats.includes(b);
        g.fillStyle = down ? 'rgba(220,0,0,0.6)' : 'rgba(0,0,0,0.15)';
        g.fillRect(X(b), top + 5, down ? 2 : 1, 455);
      }
      // envelopes: one strip per band, step-drawn per frame (frame i covers [i/fps, (i+1)/fps))
      d.bands.forEach((band, bi) => {
        const y0 = top + 150 + bi * 64;
        g.fillStyle = '#000';
        g.fillText(band, 8, y0 + 4);
        g.strokeStyle = '#ddd';
        g.beginPath();
        g.moveTo(x0, y0 + 56);
        g.lineTo(x0 + 1500, y0 + 56);
        g.stroke();
        const e = d.env?.[band] ?? [];
        g.strokeStyle = colors[band]!;
        g.lineWidth = 1.5;
        g.beginPath();
        for (let i = Math.max(0, Math.floor(p.t0 * d.fps)); i < e.length && i / d.fps < p.t1; i++) {
          const y = y0 + 56 - e[i]! * 54;
          g.lineTo(X(i / d.fps), y);
          g.lineTo(X((i + 1) / d.fps), y);
        }
        g.stroke();
      });
    });
    return cv.toDataURL('image/png');
  }, data);
  await browser.close();
  return Buffer.from(png.split(',')[1]!, 'base64');
}

await mkdir(OUT, { recursive: true });
const spec = JobSpec.parse(JSON.parse(await readFile(specPath, 'utf8')));
const styles = resolveStyles(spec, RECIPES, TRAIT_META);
assertResolved(styles);
const rec = recipe(styles.job.recipe);
const stage = await prepareMusic({ spec, specDir, choreography: rec.choreography, fps: 30, samples: nodeSampleBank() });
const { sheet } = stage;
if (!sheet.envelopes || !stage.music) throw new Error('the spec has no music stem, so there are no envelopes to show');
console.log(`music: ${JSON.stringify(stage.info)}; ${sheet.frames} frames, bpm ${sheet.bpm ?? '—'}`);

const plotPath = join(OUT, `${NAME}-envelopes.png`);
const zoomAt = sheet.sections[1]?.timing.holdStart ?? 8;
await writeFile(plotPath, await plot(sheet, stage.music, [zoomAt, zoomAt + 4]));
console.log(`envelope plot → ${plotPath}`);

const bundle = await buildBundle({ spec, specDir, outDir: join(OUT, `bundle-${NAME}`), traits: usedTraits(styles) });
const srv = await serveDir(bundle.dir);
const browser = await launchBrowser();
const input = await reelInput({ spec, sheet, formatId: fmt, specDir, bundle, styles });
const tab = await ReelTab.open(browser, { origin: srv.url, entry: bundle.entry, input });
const bass = sheet.envelopes.bass;
const on: Buffer[] = [];
const off: Buffer[] = [];
for (const s of sheet.sections.filter((x) => x.timing.holdEnd - x.timing.holdStart > 0.3).slice(0, 5)) {
  // whole frames inside the hold, after the last landing settled
  const f0 = Math.ceil(s.timing.holdStart * sheet.fps);
  const f1 = Math.floor(s.timing.holdEnd * sheet.fps) - 1;
  let hi = f0;
  let lo = f0;
  for (let f = f0; f <= f1; f++) {
    if (bass[f]! > bass[hi]!) hi = f;
    if (bass[f]! < bass[lo]!) lo = f;
  }
  const hero = async (f: number) => {
    await tab.seek(f / sheet.fps);
    const boxes = await tab.boxes();
    const b = boxes.reduce((a, x) => (x.h > a.h ? x : a), boxes[0]!);
    return { png: await tab.shot({ format: 'png' }), b };
  };
  const a = await hero(hi);
  const z = await hero(lo);
  on.push(a.png);
  off.push(z.png);
  console.log(
    `${s.id}: kick frame ${hi} (bass ${bass[hi]}) largest box ${a.b.w.toFixed(0)}×${a.b.h.toFixed(0)}  |  ` +
      `between frame ${lo} (bass ${bass[lo]}) ${z.b.w.toFixed(0)}×${z.b.h.toFixed(0)}  "${a.b.text}"`,
  );
}
await tab.close();
await browser.close();
await srv.close();
const sheetPath = join(OUT, `${NAME}-sheet.png`);
const { w, h } = FORMATS[fmt];
await tile([...on, ...off], on.length, w, h, sheetPath);
console.log(`contact sheet (top: on a kick, bottom: between kicks) → ${sheetPath}`);
