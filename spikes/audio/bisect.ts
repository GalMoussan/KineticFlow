/** Spike M0e step 2: which node makes OfflineAudioContext output vary between identical renders? */
import { serve, launch } from '../lib.ts';

type AudioWindow = { renderOffline(o: Record<string, unknown>): Promise<{ floatHash: string; ms: number }> };

const here = new URL('.', import.meta.url).pathname;
const srv = await serve(here + 'www');
const browser = await launch('shell');
const page = await browser.newPage();
await page.goto(srv.url + '/index.html');
await page.waitForFunction('window.graphReady === true');

const all = ['kick', 'hats', 'pluck', 'reverb', 'comp'];
const variants: { name: string; opts: Record<string, unknown> }[] = [
  { name: 'everything', opts: {} },
  { name: 'no track', opts: { withTrack: false } },
  { name: 'only kick', opts: { withTrack: false, off: all.filter((x) => x !== 'kick') } },
  { name: 'only hats', opts: { withTrack: false, off: all.filter((x) => x !== 'hats') } },
  { name: 'only pluck', opts: { withTrack: false, off: all.filter((x) => x !== 'pluck') } },
  { name: 'only track', opts: { off: all } },
  { name: 'pluck + reverb', opts: { withTrack: false, off: ['kick', 'hats', 'comp'] } },
  { name: 'kick + comp', opts: { withTrack: false, off: ['hats', 'pluck', 'reverb'] } },
  { name: 'all but reverb', opts: { off: ['reverb'] } },
  { name: 'all but comp', opts: { off: ['comp'] } },
];
for (const v of variants) {
  const hashes = new Set<string>();
  for (let i = 0; i < 4; i++) {
    hashes.add((await page.evaluate((o) => (window as unknown as AudioWindow).renderOffline(o), v.opts)).floatHash);
  }
  console.log(`${v.name.padEnd(16)} distinct hashes over 4 runs: ${hashes.size}`);
}
await browser.close();
await srv.close();
