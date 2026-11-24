/**
 * M3 acceptance "preview and render audio hashes match": the same renders in Chromium (esbuild bundle, Playwright,
 * as @reel/render runs pages) and in Node must be bit-identical. Samples reach the page as the same file bytes and
 * are decoded there. Skips when Chromium or the render package's tooling is unavailable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dilemmaSheet, sheetSoundCues } from '../dev/fixtures.ts';
import { loadSampleBank, sampleBytes } from '../dev/samples.ts';
import { MUSIC_PRESETS, PRESET_DEFAULT_BPM as BPM, renderMusic, renderSfx, type Stereo } from './index.ts';

const fromRender = createRequire(fileURLToPath(new URL('../../render/package.json', import.meta.url)));

/** The slices of Playwright and esbuild this test uses (both live in @reel/render, not in this package). */
interface Page {
  route(url: string, handler: (r: { fulfill(o: { contentType: string; body: string }): Promise<void> }) => unknown): Promise<void>;
  goto(url: string): Promise<unknown>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  version(): string;
}
interface Playwright {
  chromium: { launch(o: { headless: boolean }): Promise<Browser> };
}
interface Esbuild {
  build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }>;
}
declare global {
  /** Installed by the page bundle below. */
  var __audioHashes: (input: unknown) => Promise<Record<string, string>>;
}

const ENTRY = `
import { decodeWav, renderMusic, renderSfx } from './index.ts';
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hash(x) {
  const buf = new Uint8Array(x.l.byteLength + x.r.byteLength);
  buf.set(new Uint8Array(x.l.buffer, x.l.byteOffset, x.l.byteLength), 0);
  buf.set(new Uint8Array(x.r.buffer, x.r.byteOffset, x.r.byteLength), x.l.byteLength);
  return hex(await crypto.subtle.digest('SHA-256', buf));
}
globalThis.__audioHashes = async (input) => {
  const bytes = new Map(Object.entries(input.samples).map(([id, b64]) => [id, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
  const decoded = new Map();
  const samples = { get(id) { if (!decoded.has(id) && bytes.has(id)) decoded.set(id, decodeWav(bytes.get(id))); return decoded.get(id); } };
  const out = {};
  for (const m of input.music) out[m.preset] = await hash(renderMusic(input.sheets[m.preset], m, { samples }));
  out.sfx = await hash(renderSfx(input.cues, { duration: input.duration, seed: input.seed, samples }));
  return out;
};
`;

const hash = (x: Stereo) =>
  createHash('sha256').update(new Uint8Array(x.l.buffer, x.l.byteOffset, x.l.byteLength)).update(new Uint8Array(x.r.buffer, x.r.byteOffset, x.r.byteLength)).digest('hex');

test('Node and Chromium render bit-identical music and SFX (SHA-256)', async (t) => {
  let playwright: Playwright;
  let esbuild: Esbuild;
  try {
    playwright = fromRender('playwright') as Playwright;
    esbuild = fromRender('esbuild') as Esbuild;
  } catch {
    t.skip('playwright/esbuild not installed in packages/render');
    return;
  }
  let browser: Browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (e) {
    t.skip(`Chromium unavailable: ${(e as Error).message.split('\n')[0]}`);
    return;
  }
  try {
    const js = await esbuild.build({
      stdin: { contents: ENTRY, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'audio-entry.ts', loader: 'ts' },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',
      write: false,
      logLevel: 'silent',
    });
    const bank = await loadSampleBank();
    const raw = await sampleBytes();
    const sheets = Object.fromEntries(MUSIC_PRESETS.map((id) => [id, dilemmaSheet(BPM[id])]));
    const music = MUSIC_PRESETS.map((preset) => ({ preset, bpm: BPM[preset]!, seed: 1101 }));
    const cues = sheetSoundCues(sheets['lofi-jazz']!);
    const node: Record<string, string> = {};
    for (const m of music) node[m.preset] = hash(renderMusic(sheets[m.preset]!, m, { samples: bank }));
    node.sfx = hash(renderSfx(cues, { duration: 26, seed: 1101, samples: bank }));

    const page = await browser.newPage();
    // localhost is a secure context, so crypto.subtle exists.
    await page.route('http://localhost/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>audio</title>' }));
    await page.goto('http://localhost/');
    await page.addScriptTag({ content: js.outputFiles[0]!.text });
    const input = {
      samples: Object.fromEntries([...raw].map(([id, b]) => [id, Buffer.from(b).toString('base64')])),
      sheets,
      music,
      cues,
      duration: 26,
      seed: 1101,
    };
    const chromium = await page.evaluate((i) => globalThis.__audioHashes(i), input);
    t.diagnostic(`chromium ${browser.version()}: ${JSON.stringify(chromium)}`);
    assert.deepEqual(chromium, node);
  } finally {
    await browser.close();
  }
});
