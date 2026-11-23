/**
 * Step 2: harfbuzzjs (wasm, in the page under the production CSP) vs Chromium's own DOM text.
 * For each case: rasterise DOM text and the harfbuzz SVG at 200 px in chrome-headless-shell, threshold at 50 %,
 * report IoU; isolate niqqud as (full − niqqud-stripped) in both renderers and compare mark masks + centroids.
 *   node spikes/morph/fidelity.ts
 */
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { OUT, SPIKES } from './node-hb.ts';
import { openPage } from './www.ts';
import { PAINTED } from '../lib.ts';
import type {} from './page.ts'; // window.M typing

type Case = { text: string; font: 'noto' | 'rubik' | 'frank'; wght: number };
const SLUG: Record<string, string> = { 'שָׁלוֹם': 'shalom', 'קפה': 'kafe', 'דילמה': 'dilema', Talk: 'talk', 'בְּרֵאשִׁית': 'bereshit' };
const CASES: Case[] = [];
for (const wght of [400, 650, 900]) for (const text of ['שָׁלוֹם', 'קפה', 'דילמה', 'Talk', 'בְּרֵאשִׁית']) CASES.push({ text, font: 'noto', wght });
CASES.push({ text: 'שָׁלוֹם', font: 'rubik', wght: 400 }, { text: 'בְּרֵאשִׁית', font: 'rubik', wght: 700 }, { text: 'שָׁלוֹם', font: 'frank', wght: 400 });

const { page, close, initMs, renderer } = await openPage();
console.log(`browser harfbuzz init (wasm + 3 fonts fetched under CSP): ${initMs.toFixed(1)} ms; WebGL renderer: ${renderer}`);

const shot = async (c: Case, mode: 'dom' | 'dom-base' | 'hb' | 'hb-base') => {
  const info = await page.evaluate(([t, f, w, m]) => window.M.setCase(t, f, w, m), [c.text, c.font, c.wght, mode] as const);
  await page.evaluate('document.fonts.ready');
  await page.evaluate(PAINTED);
  const png = await page.screenshot({ clip: info.clip });
  await page.evaluate(([k, b]) => window.M.loadMask(k, b), [mode, png.toString('base64')] as const);
  return info;
};

const rows: Record<string, unknown>[] = [];
for (const c of CASES) {
  const hasMarks = /[\u0591-\u05C7]/.test(c.text);
  const info = await shot(c, 'dom');
  await shot(c, 'hb');
  const word = await page.evaluate(() => window.M.iou('dom', 'hb'));
  const far = await page.evaluate(() => window.M.farMismatch('dom', 'hb', 1));
  const diff = await page.evaluate(() => window.M.diffPng('dom', 'hb'));
  const diffPath = join(OUT, `fid-${c.font}-${c.wght}-${SLUG[c.text]}.png`);
  writeFileSync(diffPath, Buffer.from(diff, 'base64'));
  const row: Record<string, unknown> = {
    case: `${c.text} ${c.font}@${c.wght}`,
    iou: +(word.iou * 100).toFixed(2),
    domInkPx: word.a,
    hbInkPx: word.b,
    xorPx: far.xor,
    xorBeyond1px: far.far,
    domWidth: +info.domWidth.toFixed(2),
    hbWidth: +info.hbWidth.toFixed(2),
    diff: relative(join(SPIKES, '..'), diffPath),
  };
  if (hasMarks) {
    await shot(c, 'dom-base');
    await shot(c, 'hb-base');
    await page.evaluate(() => {
      window.M.minus('dom', 'dom-base', 'dom-marks');
      window.M.minus('hb', 'hb-base', 'hb-marks');
    });
    const marks = await page.evaluate(() => window.M.iou('dom-marks', 'hb-marks'));
    const mfar = await page.evaluate(() => window.M.farMismatch('dom-marks', 'hb-marks', 1));
    const offs = await page.evaluate(() => window.M.markOffsets('dom-marks', 'hb-marks'));
    row.markIou = +(marks.iou * 100).toFixed(2);
    row.markPx = `${marks.a}/${marks.b}`;
    row.markXorBeyond1px = mfar.far;
    row.markComponents = offs.length;
    row.markMaxOffsetPx = Math.max(...offs.map((o) => o.dist));
    row.markOffsets = offs;
  }
  rows.push(row);
  console.log(JSON.stringify({ ...row, markOffsets: undefined }));
}
await close();

const ious = rows.map((r) => r.iou as number);
const mi = rows.filter((r) => r.markIou !== undefined);
const summary = {
  initMs: +initMs.toFixed(1),
  renderer,
  cases: rows.length,
  wordIouMin: Math.min(...ious),
  wordIouMean: +(ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(2),
  xorBeyond1pxMax: Math.max(...rows.map((r) => r.xorBeyond1px as number)),
  markIouMin: Math.min(...mi.map((r) => r.markIou as number)),
  markXorBeyond1pxMax: Math.max(...mi.map((r) => r.markXorBeyond1px as number)),
  markMaxOffsetPx: Math.max(...mi.map((r) => r.markMaxOffsetPx as number)),
  maxWidthDiffPx: +Math.max(...rows.map((r) => Math.abs((r.domWidth as number) - (r.hbWidth as number)))).toFixed(3),
};
console.log('SUMMARY', JSON.stringify(summary));
writeFileSync(join(OUT, 'fidelity.json'), JSON.stringify({ summary, rows }, null, 1));
