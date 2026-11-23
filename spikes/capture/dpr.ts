/** Spike M0a: which capture call actually returns 2× pixels for supersampling? */
import { PNG } from 'pngjs';
import { serve, launch } from '../lib.ts';

const here = new URL('.', import.meta.url).pathname;
const srv = await serve(here + 'www');
const browser = await launch('shell');
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(`${srv.url}/reel12a.html`);
await page.waitForFunction('!!window.openkatanaPage');
await page.evaluate(() => (window as unknown as { openkatanaPage: { render(t: number): Promise<void> } }).openkatanaPage.render(3));
const size = (b: Buffer) => {
  const p = PNG.sync.read(b);
  return `${p.width}x${p.height}`;
};
console.log('devicePixelRatio', await page.evaluate(() => devicePixelRatio));
console.log('playwright screenshot', size(await page.screenshot()));
const plain = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
console.log('cdp no clip', size(Buffer.from(plain.data, 'base64')));
const fromSurface = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true });
console.log('cdp fromSurface', size(Buffer.from(fromSurface.data, 'base64')));
const clip = await cdp.send('Page.captureScreenshot', {
  format: 'png',
  optimizeForSpeed: true,
  clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 2 },
});
console.log('cdp clip scale 2', size(Buffer.from(clip.data, 'base64')));
await browser.close();
await srv.close();
