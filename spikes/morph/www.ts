/** Builds the browser test page into spikes/morph/www/ (bundle + hb.wasm + fonts) and serves it via lib.ts. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, SPIKES } from './node-hb.ts';
import { launch, serve } from '../lib.ts';
import type { Browser, Page } from 'playwright';

const WWW = join(HERE, 'www');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: NotoV; src: url(fonts/NotoSansHebrew.ttf); font-weight: 100 900; font-stretch: 62.5% 100%; }
@font-face { font-family: RubikV; src: url(fonts/Rubik.ttf); font-weight: 300 900; }
@font-face { font-family: FrankV; src: url(fonts/FrankRuhlLibre.ttf); font-weight: 300 900; }
html, body { margin: 0; background: #fff; }
</style></head><body><div id="stage"></div><script type="module" src="page.js"></script></body></html>`;

export function buildWww(): string {
  mkdirSync(join(WWW, 'fonts'), { recursive: true });
  execFileSync(
    join(SPIKES, 'node_modules/.bin/esbuild'),
    [join(HERE, 'page.ts'), '--bundle', '--format=esm', '--platform=browser', '--external:fs', `--outfile=${join(WWW, 'page.js')}`, '--log-level=warning'],
    { stdio: 'inherit' },
  );
  copyFileSync(join(SPIKES, 'node_modules/harfbuzzjs/hb.wasm'), join(WWW, 'hb.wasm'));
  for (const f of ['NotoSansHebrew', 'Rubik', 'FrankRuhlLibre']) copyFileSync(join(SPIKES, 'fonts', f + '.ttf'), join(WWW, 'fonts', f + '.ttf'));
  writeFileSync(join(WWW, 'index.html'), HTML);
  return WWW;
}

/** Builds, serves and opens the page; resolves once harfbuzz is initialised in the page. */
export async function openPage(): Promise<{ browser: Browser; page: Page; close(): Promise<void>; initMs: number; renderer: string }> {
  const server = await serve(buildWww());
  const browser = await launch('shell');
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(server.url + '/index.html');
  const init = await page.evaluate('window.M.ready');
  if (errors.length) throw new Error('page errors: ' + errors.join('\n'));
  const { initMs, renderer } = init as { initMs: number; renderer: string };
  return {
    browser,
    page,
    initMs,
    renderer,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}
