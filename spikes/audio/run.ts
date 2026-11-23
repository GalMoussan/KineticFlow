/** Spike M0e: is OfflineAudioContext rendering bit-identical across runs, launches and browser builds? */
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { serve, launch, type Mode } from '../lib.ts';

const here = new URL('.', import.meta.url).pathname;
const srv = await serve(here + 'www');
const rows: Record<string, unknown>[] = [];

interface Rendered {
  ms: number;
  length: number;
  seconds: number;
  peak: number;
  floatHash: string;
  pcmHash: string;
  pcm?: string;
}
/** Page global defined by www/graph.js. */
type AudioWindow = { renderOffline(o: Record<string, unknown>): Promise<Rendered> };

async function session(mode: Mode, runs: number, opts: Record<string, unknown> = {}) {
  const browser = await launch(mode);
  const page = await browser.newPage();
  await page.goto(srv.url + '/index.html');
  await page.waitForFunction('window.graphReady === true');
  const out: Rendered[] = [];
  for (let i = 0; i < runs; i++) {
    out.push(await page.evaluate((o) => (window as unknown as AudioWindow).renderOffline(o), opts));
  }
  await browser.close();
  return out;
}

for (const mode of ['shell', 'shell', 'shell-nogpu', 'chrome', 'headed'] as Mode[]) {
  for (const [i, r] of (await session(mode, 2)).entries()) {
    const { pcm, ...rest } = r;
    rows.push({ mode, run: i, ...rest });
  }
}
// Seed changes must change the output (sanity: hash is not trivially constant)
const [other] = await session('shell', 1, { seed: 7 });
rows.push({ mode: 'shell seed=7', run: 0, ...{ ...other, pcm: undefined } });

// Export path: WAV -> ffprobe length + loudness
const [withPcm] = await session('shell', 1, { returnPcm: true });
const pcm = Buffer.from(withPcm.pcm, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
header.writeUInt32LE(48000, 24); header.writeUInt32LE(48000 * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
await writeFile(here + 'out/graph.wav', Buffer.concat([header, pcm]));
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', here + 'out/graph.wav']).toString().trim();
const loud = execFileSync('ffmpeg', ['-hide_banner', '-i', here + 'out/graph.wav', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
await srv.close();

console.table(rows.map((r) => ({ ...r, floatHash: String(r.floatHash).slice(0, 16), pcmHash: String(r.pcmHash).slice(0, 16) })));
console.log('wav duration', dur);
console.log(JSON.stringify(rows));
void loud;
