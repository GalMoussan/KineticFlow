/** Spike M0e step 3: stem passes + JS summing must give one hash; also size the single-graph drift. */
import { serve, launch, type Mode } from '../lib.ts';

type StemWindow = {
  renderStems(): Promise<{ ms: number; hash: string }>;
  diffReference(): Promise<{ maxAbsDiff: number; dBFS: number; differingSamples: number }>;
};

const here = new URL('.', import.meta.url).pathname;
const srv = await serve(here + 'www');
const hashes = new Set<string>();
for (const mode of ['shell', 'shell', 'chrome', 'shell-nogpu'] as Mode[]) {
  const browser = await launch(mode);
  const page = await browser.newPage();
  await page.goto(srv.url + '/stems.html');
  await page.waitForFunction('window.stemsReady === true');
  for (let i = 0; i < 2; i++) {
    const r = await page.evaluate(() => (window as unknown as StemWindow).renderStems());
    hashes.add(r.hash);
    console.log(mode, 'stems', r.ms, 'ms', r.hash.slice(0, 16));
  }
  if (mode === 'shell') console.log('single-graph drift', await page.evaluate(() => (window as unknown as StemWindow).diffReference()));
  await browser.close();
}
console.log('distinct stem-mix hashes across 8 renders / 4 launches:', hashes.size);
await srv.close();
