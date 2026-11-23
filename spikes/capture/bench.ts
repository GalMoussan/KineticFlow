/**
 * Spike M0a/M0b: capture throughput, GPU determinism, end-to-end chunked render, motion blur + supersampling.
 * Usage: node capture/bench.ts modes|determinism|e2e|quality|long
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, writeFile, mkdir } from 'node:fs/promises';
import type { Page, CDPSession } from 'playwright';
import { PNG } from 'pngjs';
import { serve, launch, type Mode } from '../lib.ts';

const here = new URL('.', import.meta.url).pathname;
const OUT = here + 'out/';
await mkdir(OUT, { recursive: true });
const srv = await serve(here + 'www');
const FPS = 30;

type Shot = 'pw-png' | 'cdp-png' | 'cdp-jpeg';
interface Opts {
  html: string;
  mode: Mode;
  shot: Shot;
  dpr?: number;
  /** Output-frame times in seconds (page-local). */
  times: number[];
  /** Motion-blur sub-frames per output frame (1 = off) and shutter in degrees. */
  sub?: number;
  shutter?: number;
  fps?: number;
  /** When set, frames are piped into ffmpeg and encoded to this file. */
  encodeTo?: string;
}

type PageWindow = { openkatanaPage: { render(t: number): Promise<void> } };

/** CDP ignores deviceScaleFactor unless the clip carries `scale` (measured in capture/dpr.ts). */
async function capture(page: Page, cdp: CDPSession, shot: Shot, dpr = 1): Promise<Buffer> {
  if (shot === 'pw-png') return page.screenshot({ animations: 'disabled' });
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: shot === 'cdp-png' ? 'png' : 'jpeg',
    ...(shot === 'cdp-jpeg' ? { quality: 92 } : {}),
    optimizeForSpeed: true,
    ...(dpr > 1 ? { clip: { x: 0, y: 0, width: 1080, height: 1920, scale: dpr } } : {}),
  });
  return Buffer.from(data, 'base64');
}

function ffmpegArgs(o: Opts): string[] {
  const fps = o.fps ?? FPS;
  const sub = o.sub ?? 1;
  const vf: string[] = [];
  if (sub > 1) vf.push(`tmix=frames=${sub}`, `select='eq(mod(n\\,${sub})\\,${sub - 1})'`, `setpts=N/(${fps}*TB)`);
  vf.push('scale=1080:1920:flags=lanczos:out_color_matrix=bt709:out_range=tv', 'format=yuv420p');
  return [
    '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps * sub), '-c:v', o.shot === 'cdp-jpeg' ? 'mjpeg' : 'png', '-i', '-',
    '-vf', vf.join(','), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-g', String(fps * 2),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', o.encodeTo!,
  ];
}

/** Renders one chunk; returns timing breakdown. */
async function run(o: Opts) {
  const t0 = performance.now();
  const browser = await launch(o.mode);
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: o.dpr ?? 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${srv.url}/${o.html}`);
  await page.waitForFunction('!!window.openkatanaPage');
  await page.evaluate(() => (window as unknown as PageWindow).openkatanaPage.render(0));
  const ready = performance.now();
  const ff = o.encodeTo ? spawn('ffmpeg', ffmpegArgs(o), { stdio: ['pipe', 'inherit', 'inherit'] }) : null;
  const ffDone = ff ? new Promise<number | null>((r) => ff.on('close', r)) : null;
  const sub = o.sub ?? 1;
  const fps = o.fps ?? FPS;
  const shutter = (o.shutter ?? 180) / 360;
  let renderMs = 0;
  let shotMs = 0;
  let bytes = 0;
  for (const t of o.times) {
    for (let s = 0; s < sub; s++) {
      const ts = sub > 1 ? t + (((s + 0.5) / sub) * shutter - shutter / 2) / fps : t;
      const a = performance.now();
      await page.evaluate((x) => (window as unknown as PageWindow).openkatanaPage.render(x), ts);
      const b = performance.now();
      const img = await capture(page, cdp, o.shot, o.dpr ?? 1);
      shotMs += performance.now() - b;
      renderMs += b - a;
      bytes += img.length;
      if (ff && !ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    }
  }
  await browser.close();
  const loopEnd = performance.now();
  if (ff) {
    ff.stdin.end();
    if ((await ffDone) !== 0) throw new Error('ffmpeg failed');
  }
  const captures = o.times.length * sub;
  return {
    html: o.html, mode: o.mode, shot: o.shot, dpr: o.dpr ?? 1, sub, frames: o.times.length, captures,
    startupMs: Math.round(ready - t0),
    renderMsPerCapture: +(renderMs / captures).toFixed(1),
    shotMsPerCapture: +(shotMs / captures).toFixed(1),
    loopFps: +(o.times.length / ((loopEnd - ready) / 1000)).toFixed(2),
    totalMs: Math.round(performance.now() - t0),
    avgKB: Math.round(bytes / captures / 1024),
  };
}

async function log(name: string, row: object) {
  console.log(JSON.stringify(row));
  await appendFile(OUT + `${name}.jsonl`, JSON.stringify(row) + '\n');
}

const sampled = (n: number, total = 390) => Array.from({ length: n }, (_, i) => Math.round((i * (total - 1)) / (n - 1)) / FPS);
const range = (from: number, count: number, fps = FPS) => Array.from({ length: count }, (_, i) => from + i / fps);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

const cmd = process.argv[2];

if (cmd === 'modes') {
  // E1: per-frame cost by launch mode and capture method, 40 frames sampled across the 13 s chunk.
  for (const html of ['reel12a.html', 'reel9a.html', 'webgl.html']) {
    for (const [mode, shot] of [['shell-nogpu', 'pw-png'], ['shell', 'pw-png'], ['shell', 'cdp-png'], ['shell', 'cdp-jpeg']] as [Mode, Shot][]) {
      await log('modes', await run({ html, mode, shot, times: sampled(40) }));
    }
  }
}

if (cmd === 'determinism') {
  // E2: forward vs reverse order (same launch) and launch vs launch, GPU on vs off; size of any pixel difference.
  const diff = (a: Buffer, b: Buffer) => {
    const x = PNG.sync.read(a).data;
    const y = PNG.sync.read(b).data;
    let max = 0;
    let px = 0;
    for (let i = 0; i < x.length; i += 4) {
      const d = Math.max(Math.abs(x[i]! - y[i]!), Math.abs(x[i + 1]! - y[i + 1]!), Math.abs(x[i + 2]! - y[i + 2]!));
      if (d) px++;
      if (d > max) max = d;
    }
    return { max, pct: +((100 * px) / (x.length / 4)).toFixed(4) };
  };
  const picks = sampled(6);
  async function pass(html: string, mode: Mode, reverse: boolean) {
    const browser = await launch(mode);
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${srv.url}/${html}`);
    await page.waitForFunction('!!window.openkatanaPage');
    const got = new Map<number, Buffer>();
    for (const t of reverse ? [...picks].reverse() : picks) {
      await page.evaluate((x) => (window as unknown as PageWindow).openkatanaPage.render(x), t);
      got.set(t, await capture(page, cdp, 'cdp-png'));
    }
    // same launch, reversed again: isolates order effects from launch effects
    const again = new Map<number, Buffer>();
    for (const t of reverse ? picks : [...picks].reverse()) {
      await page.evaluate((x) => (window as unknown as PageWindow).openkatanaPage.render(x), t);
      again.set(t, await capture(page, cdp, 'cdp-png'));
    }
    await browser.close();
    return { got, again };
  }
  for (const html of ['reel12a.html', 'reel9a.html', 'webgl.html']) {
    for (const mode of ['shell', 'shell-nogpu'] as Mode[]) {
      const a = await pass(html, mode, false);
      const b = await pass(html, mode, false);
      const frames = picks.map((t) => ({
        f: Math.round(t * FPS),
        sameLaunchOrder: diff(a.got.get(t)!, a.again.get(t)!),
        acrossLaunch: diff(a.got.get(t)!, b.got.get(t)!),
      }));
      await log('determinism', { html, mode, frames });
    }
  }
}

if (cmd === 'e2e') {
  // E3: whole 26 s reel = 780 frames, split into N chunks rendered by N parallel browsers, encoded per chunk,
  // concatenated with -c copy and muxed with the original audio.
  const reel = process.argv[3] ?? '12';
  const workers = Number(process.argv[4] ?? 4);
  const shot = (process.argv[5] ?? 'cdp-png') as Shot;
  const final = process.argv[6] === 'final';
  const fps = final ? 60 : FPS;
  const total = 26 * fps;
  const quality: Partial<Opts> = final ? { fps: 60, sub: 6, dpr: 2 } : {};
  const tag = `${reel}-${workers}w-${shot}${final ? '-final' : ''}`;
  const per = Math.ceil(total / workers);
  const t0 = performance.now();
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, k) => {
      const start = k * per;
      const count = Math.min(per, total - start);
      // page "a" has OFFSET 0; time is absolute so one page serves every chunk
      return run({ html: `reel${reel}a.html`, mode: 'shell', shot, ...quality, times: range(start / fps, count, fps), encodeTo: `${OUT}e2e-${tag}-${k}.mp4` });
    }),
  );
  const list = parts.map((_, k) => `file '${OUT}e2e-${tag}-${k}.mp4'`).join('\n');
  await writeFile(`${OUT}e2e-${tag}.txt`, list);
  const c0 = performance.now();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${OUT}e2e-${tag}.txt`,
    '-i', `${process.env.HOME}/projects/dilemaCafe/reel/dilemma-cafe-reel-${reel}.mp4`,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', `${OUT}e2e-${tag}.mp4`]);
  const concatMs = performance.now() - c0;
  const probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,nb_read_frames,pix_fmt,profile,color_space:format=duration,size', '-of', 'json', `${OUT}e2e-${tag}.mp4`]).toString();
  await log('e2e', { reel, workers, shot, wallMs: Math.round(performance.now() - t0), concatMs: Math.round(concatMs), parts, probe: JSON.parse(probe) });
}

if (cmd === 'quality') {
  // E4: cost of each quality lever on 1 s of the neon reel around a fast section (t = 2..3 s).
  const html = process.argv[3] ?? 'reel9a.html';
  const shot = (process.argv[4] ?? 'cdp-png') as Shot;
  const only = process.argv[5]?.split(',');
  const variants: [string, Partial<Opts>][] = [
    ['standard', {}],
    ['ss2', { dpr: 2 }],
    ['blur6', { sub: 6 }],
    ['fps60', { fps: 60 }],
    ['final', { fps: 60, sub: 6, dpr: 2 }],
    ['final-b4', { fps: 60, sub: 4, dpr: 2 }],
  ];
  for (const [name, v] of variants.filter(([n]) => !only || only.includes(n))) {
    const fps = v.fps ?? FPS;
    const tag = `${html.replace('.html', '')}-${shot}-${name}`;
    const r = await run({ html, mode: 'shell', shot, times: range(2, fps, fps), ...v, encodeTo: `${OUT}quality-${tag}.mp4` });
    await log('quality', { variant: name, secondsOfVideo: 1, ...r });
  }
}

if (cmd === 'long') {
  // E5: does one page survive 780 frames (the observed OpenKatana crash) when frames are streamed, not stored?
  const r = await run({ html: 'reel9a.html', mode: 'shell', shot: 'cdp-png', times: range(0, 780), encodeTo: `${OUT}long-9.mp4` });
  await log('long', r);
}

await srv.close();
