// Throwaway M7 check: the Look step's AI music option against a running `reelgen serve` (REEL_URL).
import { createRequire } from 'node:module';
import type * as Playwright from 'playwright';
const { chromium } = createRequire(new URL('../../../packages/render/package.json', import.meta.url))('playwright') as typeof Playwright;

const BASE = (process.env.REEL_URL ?? 'http://127.0.0.1:5199').replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
const t0 = performance.now();
const log = (m: string) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);
try {
  await page.goto(`${BASE}/`);
  await page.getByRole('button', { name: 'New blank project' }).click();
  await page.waitForURL(/\/p\/[^/]+$/);
  await page.getByTestId('paste').fill('ערב ג׳אז בקפה\nיום שלישי 1.12 בשעה 19:30\nבואו!');
  await page.getByLabel('Split with').selectOption('rules');
  await page.getByRole('button', { name: 'Split into sections' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.section-card').length >= 2, null, { timeout: 30_000 });
  await page.locator('#step-look').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const presets = await page.locator('[data-path="music"] .music-card, .music-card').count();
  log(`preset cards: ${presets}`);
  await page.getByRole('radio', { name: 'AI' }).or(page.getByRole('button', { name: 'AI', exact: true })).first().click();
  await page.locator('[data-path="music-ai"] textarea').first().fill('upbeat acoustic cafe jazz, upright bass, brushed drums, instrumental');
  await page.screenshot({ path: 'out/dev/web/m7-ai-before.png' });
  await page.getByRole('button', { name: /Generate/ }).click();
  await page.waitForSelector('[data-path="music-ai"] .progress', { timeout: 20_000 }).then(
    () => log('progress shown'),
    () => log('no progress bar (cache hit?)'),
  );
  await page.waitForSelector('[data-path="music-ai"] canvas', { timeout: 300_000 });
  log('clip generated, waveform shown');
  await page.waitForTimeout(500);
  await page.locator('[data-path="music-ai"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'out/dev/web/m7-ai-done.png' });
  const music = await page.evaluate(async () => {
    const id = location.pathname.split('/').pop();
    const p = await (await fetch(`/api/projects/${id}`)).json();
    return p.spec?.music ?? p.project?.spec?.music;
  });
  log(`spec music: ${JSON.stringify(music)}`);
  console.log('PASS');
} finally {
  await browser.close();
}
