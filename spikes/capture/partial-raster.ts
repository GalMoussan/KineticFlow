/** M2 follow-up to M0a: cost of `--disable-partial-raster` (fixes order-dependent AA residue) on capture throughput. */
import { serve, launch, GPU_ARGS } from '../lib.ts';

type PageWindow = { openkatanaPage: { render(t: number): Promise<void> } };
const here = new URL('.', import.meta.url).pathname;
const srv = await serve(here + 'www');
const times = Array.from({ length: 60 }, (_, i) => Math.round((i * 389) / 59) / 30);

for (const html of ['reel12a.html', 'reel9a.html', 'webgl.html']) {
  for (const extra of [[], ['--disable-partial-raster']]) {
    const browser = await launch('shell', { args: [...GPU_ARGS, ...extra] });
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${srv.url}/${html}`);
    await page.waitForFunction('!!window.openkatanaPage');
    await page.evaluate(() => (window as unknown as PageWindow).openkatanaPage.render(0));
    const t0 = performance.now();
    for (const t of times) {
      await page.evaluate((x) => (window as unknown as PageWindow).openkatanaPage.render(x), t);
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
    }
    const fps = times.length / ((performance.now() - t0) / 1000);
    console.log(`${html.padEnd(13)} ${extra.length ? 'no partial raster' : 'default          '} ${fps.toFixed(1)} fps`);
    await browser.close();
  }
}
await srv.close();
