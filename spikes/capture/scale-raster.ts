/**
 * M2: does a CSS `scale()` on a plain (trait-owned) element make frames depend on seek order, and why?
 * Each case shows one element at scale K after a different history (fresh, after scale 1, after scale 0, after a
 * ramp) and compares the screenshots with the fresh one. Run with and without --disable-partial-raster.
 *   node spikes/capture/scale-raster.ts
 */
import { PNG } from 'pngjs';
import { launch, GPU_ARGS, PAINTED } from '../lib.ts';

const K = 0.37;
const SVG = `<svg width="100%" height="100%" viewBox="0 0 100 100" style="display:block;overflow:visible"><circle cx="50" cy="50" r="48" fill="#E53935"/><path d="M10 50 L90 50" stroke="#1E5EFF" stroke-width="3"/></svg>`;
const CASES: Record<string, { html: string; set: string }> = {
  'svg scale()': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%">${SVG}</div>`, set: 'scale' },
  'svg scale() will-change': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%;will-change:transform">${SVG}</div>`, set: 'scale' },
  'svg scale() + rotate': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%">${SVG}</div>`, set: 'scale-rot' },
  'div radius scale()': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;border-radius:50%;background:#E53935;transform-origin:50% 50%"></div>`, set: 'scale' },
  'text scale()': { html: `<div id="e" style="position:absolute;left:300px;top:300px;font:900 200px sans-serif;color:#1F1F1F;transform-origin:50% 50%">Bauhaus</div>`, set: 'scale' },
  'svg scale() over canvas': { html: `<canvas id="c" width="1000" height="1000" style="position:absolute;left:0;top:0"></canvas><div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%">${SVG}</div><script>const g=document.getElementById('c').getContext('2d');g.fillStyle='#1B2A4A';g.fillRect(0,0,1000,1000);</script>`, set: 'scale' },
  'text scale() over canvas': { html: `<canvas id="c" width="1000" height="1000" style="position:absolute;left:0;top:0"></canvas><div id="e" style="position:absolute;left:300px;top:300px;font:900 200px sans-serif;color:#F5F1E6;transform-origin:50% 50%">Bauhaus</div><script>const g=document.getElementById('c').getContext('2d');g.fillStyle='#1B2A4A';g.fillRect(0,0,1000,1000);</script>`, set: 'scale' },
  'svg scale() in will-change parent': { html: `<div style="position:absolute;inset:0;will-change:transform"><div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%">${SVG}</div></div>`, set: 'scale' },
  'svg scale() + blur(1px)': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%;filter:blur(1px)">${SVG}</div>`, set: 'scale' },
  'svg scale() + opacity .9': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%;opacity:.9">${SVG}</div>`, set: 'scale' },
  'svg scale() + blend multiply': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%;mix-blend-mode:multiply">${SVG}</div>`, set: 'scale' },
  'svg scale() in blurred parent': { html: `<div style="position:absolute;inset:0;filter:blur(0.5px)"><div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%">${SVG}</div></div>`, set: 'scale' },
  'svg scale() in clip-path parent': { html: `<div style="position:absolute;inset:0;clip-path:inset(1px)"><div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px;transform-origin:50% 50%">${SVG}</div></div>`, set: 'scale' },
  'svg box rewrite': { html: `<div id="e" style="position:absolute;left:300px;top:300px;width:400px;height:400px">${SVG}</div>`, set: 'box' },
};

const apply = (set: string, k: number) => `(() => {
  const e = document.getElementById('e');
  if ('${set}' === 'box') { const s = 400 * ${k}; Object.assign(e.style, { left: (500 - s / 2) + 'px', top: (500 - s / 2) + 'px', width: s + 'px', height: s + 'px', visibility: ${k} > 0 ? 'visible' : 'hidden' }); }
  else e.style.transform = 'scale(' + ${k} + ')' + ('${set}' === 'scale-rot' ? ' rotate(' + (${k} * 40) + 'deg)' : '');
})()`;

function delta(a: Buffer, b: Buffer): number {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  let m = 0;
  for (let i = 0; i < x.data.length; i++) m = Math.max(m, Math.abs(x.data[i]! - y.data[i]!));
  return m;
}

const HISTORIES: Record<string, number[]> = {
  'after 1': [1],
  'after 0': [0],
  'after ramp': [0, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.05, 1],
  'after 0.001': [0.001],
  'after 0.05': [0.05],
  'after 3': [3],
};

for (const extra of [['--disable-partial-raster']]) {
  const browser = await launch('shell', { args: [...GPU_ARGS, ...extra] });
  console.log(`\n${extra.length ? '--disable-partial-raster' : 'default (partial raster)'}`);
  for (const [name, c] of Object.entries(CASES)) {
    const shot = async (hist: number[]) => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await page.setContent(`<html><body style="margin:0;background:#F5F1E6">${c.html}</body></html>`);
      for (const k of [...hist, K]) {
        await page.evaluate(apply(c.set, k));
        await page.evaluate(PAINTED);
        await cdp.send('Page.captureScreenshot', { format: 'png' });
      }
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await ctx.close();
      return Buffer.from(data, 'base64');
    };
    const fresh = await shot([]);
    const out = [];
    for (const [h, hist] of Object.entries(HISTORIES)) out.push(`${h} Δ${delta(fresh, await shot(hist))}`);
    console.log(`  ${name.padEnd(26)} ${out.join('  ')}`);
  }
  await browser.close();
}
