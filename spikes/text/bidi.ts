/**
 * M0c mixed bidi: bidi-js visual order vs Chromium's native order, and LTR-run isolation strategies.
 * Run: node spikes/text/bidi.ts   → out/bidi.json, out/bidi.png, summary on stdout.
 */
import { LINES, type FontKey } from './strings.ts';
import { analyzeLine, levelTree, visualOrder, isUnit, type Granularity, type LevelNode } from './units.ts';
import type { RenderInfo, Variant } from './dom-page.ts';
import { bundle, openPage, r2, shot, start, unionBox, writeOut, type BBox, type Cell } from './harness.ts';

const STAGE = { width: 2600, height: 240 };
const BIDI_LINES = ['mixed', 'mirror', 'nested', 'numparen'];
const VARIANTS: Variant[] = ['ib', 'iso', 'visual', 'abs'];
const GRANS: Granularity[] = ['grapheme', 'word'];
const FONT: FontKey = 'rubik';

// ---- 1. pure bidi-js: levels, visual strings, cost ----
const show = (s: string) => s.replace(/ /g, '␣');
const treeStr = (n: LevelNode): string =>
  `${n.level & 1 ? 'R' : 'L'}${n.level}[${n.children.map((c) => (isUnit(c) ? show(c.text) : treeStr(c))).join(' ')}]`;
const pure: Record<string, { dir: string; levels: string; visual: string; tree: string }> = {};
for (const line of LINES) {
  const a = analyzeLine(line.source, 'word');
  pure[line.id] = {
    dir: a.dir,
    levels: Array.from(a.levels).join(''),
    visual: visualOrder(a).map((i) => a.units[i].text).join(''),
    tree: treeStr(levelTree(a)),
  };
}
const ITER = 2000;
const tc = performance.now();
for (let k = 0; k < ITER; k++)
  for (const line of LINES)
    for (const g of GRANS) {
      const a = analyzeLine(line.source, g);
      visualOrder(a);
      levelTree(a);
    }
const usPerLine = ((performance.now() - tc) * 1000) / (ITER * LINES.length * GRANS.length);

// ---- 2. browser: native order vs bidi-js, and per-strategy order errors ----
await bundle('dom-page.ts');
const env = await start();
const page = await openPage(env.browser, `${env.url}/text/build/dom-page.html`, STAGE);
const clip = { x: 0, y: 0, ...STAGE };
const render = async (line: string, variant: Variant, gran: Granularity) => {
  const info = await page.evaluate(
    ([l, f, v, g]) => {
      const api: { render(l: string, f: string, v: string, g: string): RenderInfo } = Reflect.get(window, 'T');
      return api.render(l, f, v, g);
    },
    [line, FONT, variant, gran] as const,
  );
  return { info, png: await shot(page, clip) };
};

const results: { line: string; gran: Granularity; nativeVsBidiMismatches: number; strategies: Record<string, { orderErrors: number; diffPctInk: number; bboxShift: number }> }[] = [];
const sheetRows: { label: string; cells: Cell[] }[] = [];
for (const line of LINES)
  for (const gran of GRANS) {
    const ref = await render(line.id, 'plain', gran);
    const r = { line: line.id, gran, nativeVsBidiMismatches: ref.info.order.filter((u, i) => u !== ref.info.bidiOrder[i]).length, strategies: {} as Record<string, { orderErrors: number; diffPctInk: number; bboxShift: number }> };
    const pngs = [ref.png];
    const boxes: BBox[] = [];
    for (const v of VARIANTS) {
      const got = await render(line.id, v, gran);
      const d = await env.analyzer.diff(ref.png, got.png);
      boxes.push(d.bboxA, d.bboxB);
      r.strategies[v] = { orderErrors: got.info.order.filter((u, i) => u !== ref.info.order[i]).length, diffPctInk: r2(d.diffPctInk), bboxShift: d.bboxShift };
      pngs.push(got.png);
    }
    results.push(r);
    if (BIDI_LINES.includes(line.id)) {
      const crop = unionBox(boxes, 14, { w: STAGE.width, h: STAGE.height });
      sheetRows.push({ label: `${line.id} (${gran})\nbidi-js: ${pure[line.id].visual}`, cells: pngs.map((png) => ({ png, crop })) });
    }
  }
const sheet = writeOut(
  'bidi.png',
  await env.analyzer.sheet({ title: `Mixed bidi, ${FONT} 96 px: native unsplit reference vs split strategies`, scale: 0.5, cols: ['native (unsplit)', ...VARIANTS.map((v) => `${v} split`)], rows: sheetRows }),
);
writeOut('bidi.json', JSON.stringify({ pure, usPerLine, results }, null, 1));
await env.close();

console.log(`bidi-js analyse+visualOrder+levelTree: ${r2(usPerLine)} µs per line (mean over ${ITER}×${LINES.length}×2)`);
for (const id of BIDI_LINES) console.log(`${id.padEnd(9)} dir=${pure[id].dir} levels=${pure[id].levels}\n  visual(bidi-js, L→R): ${pure[id].visual}\n  tree: ${pure[id].tree}`);
console.log('\nline      gran      native≠bidi  ' + VARIANTS.map((v) => `${v}: orderErr/diff%/bbox`.padEnd(28)).join(''));
for (const r of results)
  console.log(
    `${r.line.padEnd(9)} ${r.gran.padEnd(9)} ${String(r.nativeVsBidiMismatches).padStart(11)}  ` +
      VARIANTS.map((v) => `${r.strategies[v].orderErrors}/${r.strategies[v].diffPctInk}/${r.strategies[v].bboxShift}`.padEnd(28)).join(''),
  );
console.log(`\nevidence: ${sheet}`);
