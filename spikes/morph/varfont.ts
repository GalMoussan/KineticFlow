/**
 * Step 5: variable-font weight animation by re-shaping with harfbuzz every frame (wght 400→900),
 * vs CSS font-variation-settings. Cost per frame (Node + Chromium), determinism, outline-structure stability
 * (can two instances be lerped instead?), and a 12-step contact sheet.
 *   node spikes/morph/varfont.ts
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseHbPath, shapeText } from './hb.ts';
import { loadFonts, OUT, SPIKES } from './node-hb.ts';
import { openPage } from './www.ts';
import type {} from './page.ts';

const WORDS = ['שָׁלוֹם', 'קפה', 'דילמה', 'Talk', 'בְּרֵאשִׁית'];
const FRAMES = 300;
const { noto } = await loadFonts();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const wghtAt = (i: number) => 400 + (500 * i) / (FRAMES - 1);

type Row = Record<string, string | number | boolean>;
const rows: Row[] = [];
for (const word of WORDS) {
  // warm-up
  for (let i = 0; i < 30; i++) shapeText(noto, word, 200, wghtAt(i), false);
  // full re-shape + outlines + path string per frame
  let t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) shapeText(noto, word, 200, wghtAt(i), false);
  const fullUs = ((performance.now() - t0) * 1000) / FRAMES;
  // shaping only (setVariations + shape + positions), no outlines
  t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    noto.font.setVariations({ wght: wghtAt(i) });
    const buf = noto.hb.createBuffer();
    buf.addText(word);
    buf.guessSegmentProperties();
    noto.hb.shape(noto.font, buf);
    buf.json();
    buf.destroy();
  }
  const shapeUs = ((performance.now() - t0) * 1000) / FRAMES;
  // determinism: same wght list twice, and reversed (seek order)
  const ws = Array.from({ length: 61 }, (_, i) => 400 + (500 * i) / 60);
  const a = ws.map((w) => shapeText(noto, word, 200, w, false).d);
  const b = [...ws].reverse().map((w) => shapeText(noto, word, 200, w, false).d).reverse();
  // structure: identical command sequence at 400 and 900 → lerp(400, 900) possible; compare with true 650
  const s4 = shapeText(noto, word, 200, 400, false);
  const s9 = shapeText(noto, word, 200, 900, false);
  const s65 = shapeText(noto, word, 200, 650, false);
  const sameStructure =
    s4.glyphs.length === s9.glyphs.length &&
    s4.glyphs.every((g, i) => {
      const h = s9.glyphs[i]!;
      return g.g === h.g && g.cmds.length === h.cmds.length && g.cmds.every((c, k) => c.c === h.cmds[k]!.c && c.p.length === h.cmds[k]!.p.length);
    });
  let lerpErr = NaN;
  if (sameStructure) {
    lerpErr = 0;
    s65.glyphs.forEach((g, gi) =>
      g.cmds.forEach((c, k) =>
        c.p.forEach((v, j) => {
          const l = (s4.glyphs[gi]!.cmds[k]!.p[j]! + s9.glyphs[gi]!.cmds[k]!.p[j]!) / 2;
          lerpErr = Math.max(lerpErr, Math.abs(l - v));
        }),
      ),
    );
  }
  rows.push({
    word,
    glyphs: s4.glyphs.length,
    nodeFullUs: +fullUs.toFixed(1),
    nodeShapeOnlyUs: +shapeUs.toFixed(1),
    deterministic: a.every((d, i) => d === b[i]) && sha(a.join()) === sha(ws.map((w) => shapeText(noto, word, 200, w, false).d).join()),
    hash: sha(a.join('\n')),
    sameStructure400_900: sameStructure,
    lerpVsReshapeMaxErrPx650: +lerpErr.toFixed(3),
    widthPx400_650_900: `${s4.width.toFixed(1)}/${s65.width.toFixed(1)}/${s9.width.toFixed(1)}`,
  });
}
// raw glyph-to-path cost for reference (one glyph, no shaping)
{
  const gid = shapeText(noto, 'ש', 200, 400).glyphs[0]!.g;
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) {
    noto.font.setVariations({ wght: 400 + (i % 500) });
    parseHbPath(noto.font.glyphToPath(gid));
  }
  console.log(`glyphToPath+parse one glyph with setVariations: ${(((performance.now() - t0) * 1000) / 2000).toFixed(1)} µs`);
}

const { browser, page, close } = await openPage();
for (const r of rows) {
  const w = r.word as string;
  await page.evaluate(([t]) => window.M.benchReshape(t, 'noto', 30, false), [w] as const); // warm-up
  r.chromeFullUs = +(await page.evaluate(([t, n]) => window.M.benchReshape(t, 'noto', n, false), [w, FRAMES] as const)).frameUs.toFixed(1);
  await page.evaluate(([t]) => window.M.benchCssAxis(t, 'noto', 30), [w] as const);
  r.chromeCssStyleLayoutUs = +(await page.evaluate(([t, n]) => window.M.benchCssAxis(t, 'noto', n), [w, FRAMES] as const)).frameUs.toFixed(1);
  const ws = Array.from({ length: 61 }, (_, i) => 400 + (500 * i) / 60);
  r.nodeEqualsChrome = (await page.evaluate(([t, x]) => window.M.reshapeHash(t, 'noto', x), [w, ws] as const)) === r.hash;
  delete r.hash;
  console.log(JSON.stringify(r));
}
// contact sheet: 12 weights 400→900 re-shaped by harfbuzz, rendered as SVG in Chromium
const cells = Array.from({ length: 12 }, (_, i) => {
  const w = 400 + (500 * i) / 11;
  const sh = shapeText(noto, 'שָׁלוֹם', 200, w, false);
  return `<svg width="300" height="190" viewBox="-20 -260 ${sh.width + 40} 340"><path d="${sh.d}"/><text x="0" y="60" font-size="40" fill="#c00" font-family="sans-serif">${w.toFixed(0)}</text></svg>`;
}).join('');
const p = await browser.newPage({ viewport: { width: 1840, height: 400 }, deviceScaleFactor: 1 });
await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;display:flex;flex-wrap:wrap;width:1830px">${cells}</body>`);
const sheet = join(OUT, 'varfont-sheet.png');
await p.screenshot({ path: sheet, fullPage: true });
await close();
writeFileSync(join(OUT, 'varfont.json'), JSON.stringify(rows, null, 1));
console.log('sheet:', relative(join(SPIKES, '..'), sheet));
