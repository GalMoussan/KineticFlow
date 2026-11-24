/**
 * Happy path through the real UI against the real server (M4 acceptance):
 * new project → paste Hebrew text → split (rules) → drop two logos (background removal) → pick a style → change
 * palette and music → play the preview with audio for 3 s → Check → render a draft 9:16 → the video plays.
 *
 *   node apps/web/e2e/happy-path.ts            # uses REEL_URL or http://127.0.0.1:5180, starts `reelgen serve` if down
 *
 * Screenshots: out/dev/web/*.png
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as Playwright from 'playwright';
import type { Page } from 'playwright';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = (process.env.REEL_URL ?? 'http://127.0.0.1:5180').replace(/\/$/, '');
const SHOTS = join(REPO, 'out/dev/web');
const require = createRequire(join(REPO, 'packages/render/package.json'));
const { chromium } = require('playwright') as typeof Playwright;

const TEXT = [
  'קפה דילמה וג׳אם',
  'הנושאים הכי מעניינים וחמים היום!',
  'בואו, נשב, נדבר ונשתה קפה',
  'יהיו הפתעות',
  'יום שלישי 1.12.2026 בשעה 19:30',
  'בית החאן, קרית שמונה',
  'בואו לדבר!',
].join('\n');

let step = 0;
const t0 = performance.now();
function log(msg: string): void {
  console.log(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${msg}`);
}
async function shot(page: Page, name: string): Promise<void> {
  const file = join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  log(`screenshot ${file.slice(REPO.length + 1)}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function up(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/catalog`)).ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await up()) return null;
  const port = new URL(BASE).port || '5180';
  log(`starting reelgen serve on ${port}`);
  const child = spawn(process.execPath, ['apps/cli/src/main.ts', 'serve', '--port', port, '--no-open'], { cwd: REPO, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 120; i++) {
    if (await up()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`server did not come up at ${BASE}`);
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  const server = await ensureServer();
  const assetsBefore = new Set(((await (await fetch(`${BASE}/api/assets`)).json()) as { id: string }[]).map((a) => a.id));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`page error: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') log(`console error: ${m.text()}`);
    });

    // 1. Home → new project
    await page.goto(`${BASE}/`);
    await page.getByRole('button', { name: 'New blank project' }).waitFor();
    await shot(page, 'home');
    await page.getByRole('button', { name: 'New blank project' }).click();
    await page.waitForURL(/\/p\/[^/]+$/);
    const projectUrl = page.url();
    log(`project ${projectUrl}`);
    await page.getByTestId('paste').waitFor();
    await shot(page, 'editor-empty');

    // 2. Paste + split with the built-in rules
    await page.getByTestId('paste').fill(TEXT);
    await page.getByLabel('Split with').selectOption('rules');
    await page.getByRole('button', { name: 'Split into sections' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.section-card').length >= 5, null, { timeout: 30_000 });
    const sections = await page.locator('.section-card').count();
    log(`split into ${sections} sections`);
    // The studio lengthens the video when the split text needs more time; fall back to the one-click fix.
    await page.waitForSelector('.timing-bar, .timing-warn button', { timeout: 30_000 });
    if (await page.locator('.timing-warn button').count()) await page.locator('.timing-warn button').click();
    await page.waitForSelector('.timing-bar', { timeout: 30_000 });
    log(`duration ${await page.locator('[data-path="duration"] .slider-value').first().textContent()}`);
    // Emphasis chip: toggle a word in the tagline.
    const chip = page.locator('.section-card').nth(1).locator('.chip.word').first();
    if (await chip.count()) await chip.click();
    await shot(page, 'sections');
    // "Add section above" on section 3 inserts a new section in its place; undo removes it again.
    await page.getByRole('button', { name: 'Add a section above section 3' }).click();
    await page.locator('.insert-slot .add-section .chip', { hasText: 'Number' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.section-card').length === n + 1, sections, { timeout: 10_000 });
    const inserted = await page.locator('.section-card').nth(2).locator('.role-select').inputValue();
    assert(inserted === 'stat', `new section inserted as section 3 (found "${inserted}")`);
    await page.locator('.section-card').nth(2).scrollIntoViewIfNeeded();
    await shot(page, 'section-inserted');
    await page.keyboard.press('Meta+z');
    await page.waitForFunction((n) => document.querySelectorAll('.section-card').length === n, sections, { timeout: 10_000 });
    log(`inserted a stat above section 3, then undid it`);

    // 3. Logos with background removal
    await page.locator('#step-brand').scrollIntoViewIfNeeded();
    await page.getByTestId('logo-input').setInputFiles([join(REPO, 'examples/assets/ayalim.png'), join(REPO, 'examples/assets/kiryat-shmona.png')]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="pending-logo"]').length === 2, null, { timeout: 30_000 });
    await page.locator('[data-testid="pending-logo"]').first().scrollIntoViewIfNeeded();
    await shot(page, 'logo-background-removal');
    await page.getByRole('button', { name: /^Add all 2$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.logo-item').length >= 2 && !document.querySelector('[data-testid="pending-logo"]'), null, { timeout: 30_000 });
    await page.locator('.logo-library').scrollIntoViewIfNeeded();
    await shot(page, 'brand');
    const endLogos = await page.locator('.section-card .logo-tile.on').count();
    assert(endLogos === 2, `both new logos on the end card (${endLogos})`);

    // 4. Style grid (stills of our own content), pick a different style
    await page.locator('#step-style').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => document.querySelectorAll('.style-card .style-still img').length >= 2, null, { timeout: 120_000 });
    await page.waitForTimeout(500);
    await shot(page, 'styles');
    const pick = page.locator('.style-card[data-style="swiss-title-reveal"]');
    await pick.click();
    assert((await pick.getAttribute('aria-selected')) === 'true', 'style card selected');
    log('picked swiss-title-reveal');
    // Undo / redo (⌘Z / ⇧⌘Z) restore the previous style and the pick again.
    await page.keyboard.press('Meta+z');
    await page.waitForFunction(() => document.querySelector('.style-card[aria-selected="true"]')?.getAttribute('data-style') === 'kinetic-quote');
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForFunction(() => document.querySelector('.style-card[aria-selected="true"]')?.getAttribute('data-style') === 'swiss-title-reveal');
    log('undo/redo ok');

    // 5. Palette + music
    await page.locator('#step-look').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.locator('.palette-option', { hasText: 'bauhaus-primary' }).click();
    await page.locator('.preset-pick', { hasText: 'Synthwave Drive' }).click();
    await page.waitForTimeout(300);
    await shot(page, 'look');
    await page.locator('[data-path="music"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, 'music');

    // 6. Preview with audio: wait for the session built from the latest edits.
    const screen = page.getByTestId('screen');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="preview-status"]')?.getAttribute('data-status') === 'idle' && !document.querySelector('.screen iframe.pending') && !!document.querySelector('.screen iframe.ready'),
      null,
      { timeout: 120_000 },
    );
    await page.waitForFunction(() => /on|silent/.test(document.querySelector('.transport .muted.small')?.textContent ?? ''), null, { timeout: 60_000 });
    const before = await screen.screenshot();
    const tStart = Number(await page.getByTestId('player-time').getAttribute('data-t'));
    await page.getByTestId('play').click();
    await page.waitForTimeout(1500);
    const mid = await screen.screenshot();
    await shot(page, 'preview-playing');
    await page.waitForTimeout(1500);
    const tEnd = Number(await page.getByTestId('player-time').getAttribute('data-t'));
    const after = await screen.screenshot();
    await page.keyboard.press('Space');
    const audio = (await page.locator('.transport .muted.small').textContent())?.trim();
    log(`preview time ${tStart.toFixed(2)} → ${tEnd.toFixed(2)} s, audio ${audio}`);
    assert(tEnd - tStart > 2.2, `time advances (${tStart} → ${tEnd})`);
    assert(!before.equals(mid) && !mid.equals(after), 'frames change while playing');
    assert(audio === 'on', `preview has audio (${audio})`);

    // Jump chip + safe area overlay
    await page.locator('.jump-chips .chip').nth(2).click();
    await page.getByRole('button', { name: 'Safe area overlay' }).click();
    await page.waitForTimeout(400);
    await shot(page, 'preview-safe-area');
    await page.getByRole('button', { name: 'Safe area overlay' }).click();

    // 7. Check
    await page.getByRole('button', { name: /^Check$/ }).click();
    await page.waitForSelector('.toast', { timeout: 180_000 });
    const checkToast = await page.locator('.toast').last().textContent();
    log(`check: ${checkToast}`);
    assert(/Check (passed|:)/.test(checkToast ?? ''), 'check ran');
    await shot(page, 'check');

    // 8. Render a draft 9:16
    await page.locator('.topbar').getByRole('button', { name: /^Render/ }).click();
    const sheet = page.locator('dialog.sheet');
    await sheet.waitFor();
    for (const f of ['1:1', '4:5', '16:9']) {
      const c = sheet.locator('.format-chip', { hasText: f });
      if ((await c.getAttribute('aria-pressed')) === 'true') await c.click();
    }
    if ((await sheet.locator('.format-chip', { hasText: '9:16' }).getAttribute('aria-pressed')) !== 'true') await sheet.locator('.format-chip', { hasText: '9:16' }).click();
    await sheet.getByRole('radio', { name: 'Draft' }).check();
    await shot(page, 'render-sheet');
    await sheet.getByTestId('start-render').click();
    const panel = page.getByTestId('render-panel');
    await panel.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('.chunk span') !== null || document.querySelector('[data-testid="render-panel"]')?.getAttribute('data-state') === 'done', null, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'render-progress');
    await page.waitForFunction(() => /done|failed|cancelled/.test(document.querySelector('[data-testid="render-panel"]')?.getAttribute('data-state') ?? ''), null, { timeout: 600_000 });
    const state = await panel.getAttribute('data-state');
    if (state !== 'done') {
      await shot(page, 'render-failed');
      throw new Error(`render ${state}: ${await panel.locator('.error-box').textContent().catch(() => '')}`);
    }
    const video = page.getByTestId('render-video').first();
    await video.scrollIntoViewIfNeeded();
    const played = await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight, d: v.duration };
    });
    log(`video plays: t=${played.t.toFixed(2)} ${played.w}×${played.h}, ${played.d.toFixed(2)} s`);
    assert(played.t > 0.5 && played.w === 1080 && played.h === 1920, 'rendered video plays');
    await shot(page, 'render-done');

    // Extra screens: the style mixer and the own-track waveform.
    const mixer = page.locator('details.mixer');
    await mixer.locator('summary').click();
    await mixer.locator('summary').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await shot(page, 'mixer');
    await mixer.locator('h4', { hasText: 'Per-section style' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, 'mixer-sections');
    await mixer.locator('summary').click();
    await page.getByRole('radio', { name: 'My track' }).check();
    await page.locator('[data-path="music"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    if (await page.locator('.dropzone.compact').count()) {
      const dir = join(REPO, 'data/preview/audio');
      const wav = (await readdir(dir)).find((f) => f.endsWith('.wav'));
      assert(wav, 'a WAV to upload as a track');
      await page.locator('.dropzone.compact input[type="file"]').setInputFiles(join(dir, wav));
    }
    await page.waitForSelector('.waveform canvas:not(.skeleton)', { timeout: 30_000 });
    await page.waitForTimeout(300);
    await shot(page, 'music-track');
    await page.keyboard.press('Meta+z');

    // 9. Reload restores the project (autosave) and dark mode renders.
    const dark = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
    const dp = await dark.newPage();
    await dp.goto(projectUrl);
    await dp.waitForSelector('.section-card');
    const restored = await dp.locator('.section-card').count();
    assert(restored === sections, `autosaved sections restored (${restored}/${sections})`);
    await dp.waitForSelector('.screen iframe.ready', { timeout: 120_000 });
    await dp.waitForTimeout(800);
    await shot(dp, 'dark');
    await dark.close();

    // First run: "Start with an example" → a playing preview.
    const first = await ctx.newPage();
    const tFirst = performance.now();
    await first.goto(`${BASE}/`);
    await first.getByRole('button', { name: 'Start with an example' }).click();
    await first.waitForURL(/\/p\/[^/]+$/);
    const exampleId = first.url().split('/').pop()!;
    await first.waitForSelector('.screen iframe.ready', { timeout: 60_000 });
    await first.getByTestId('play').click();
    await first.waitForFunction(() => Number(document.querySelector('[data-testid="player-time"]')?.getAttribute('data-t')) > 3.5, null, { timeout: 30_000 });
    const firstSecs = (performance.now() - tFirst) / 1000;
    await shot(first, 'example-playing');
    log(`example: home → playing preview in ${firstSecs.toFixed(1)} s`);
    assert(firstSecs < 60, 'first run reaches a playing preview in under a minute');
    await first.close();
    if (!process.env.REEL_E2E_KEEP) {
      // Leave the user's library as it was: delete this run's project and uploads (renders stay in out/).
      const after = (await (await fetch(`${BASE}/api/assets`)).json()) as { id: string }[];
      for (const a of after.filter((x) => !assetsBefore.has(x.id))) await fetch(`${BASE}/api/assets/${a.id}`, { method: 'DELETE' });
      for (const id of [projectUrl.split('/').pop(), exampleId]) await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE' });
      log('removed the test project and its uploads (REEL_E2E_KEEP=1 keeps them)');
    }
    log('PASS');
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
