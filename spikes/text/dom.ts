/**
 * M0c DOM splitting: unsplit vs split (grapheme / word, 5 strategies) per line × font at 96 px.
 * Run: node spikes/text/dom.ts   → out/dom.json, out/dom-*.png, summary on stdout.
 */
import type { Page } from 'playwright';
import { FONT_KEYS, LINES, type FontKey } from './strings.ts';
import type { Granularity } from './units.ts';
import type { RenderInfo, Variant } from './dom-page.ts';
import { bundle, openPage, pageErrors, r1, r2, shot, start, unionBox, writeOut, type BBox, type Cell, type Diff } from './harness.ts';

const STAGE = { width: 2600, height: 240 };
/** 'plain' here is a second unsplit render: the noise-floor control. */
const SPLITS: Variant[] = ['plain', 'inline', 'ib', 'iso', 'isok', 'visual', 'abs'];
const col = (v: Variant) => SPLITS.indexOf(v);
const GRANS: Granularity[] = ['grapheme', 'word'];

await bundle('dom-page.ts');
const env = await start();
const page = await openPage(env.browser, `${env.url}/text/build/dom-page.html`, STAGE);
const clip = { x: 0, y: 0, ...STAGE };

async function render(p: Page, line: string, font: FontKey, variant: Variant, gran: Granularity): Promise<{ info: RenderInfo; png: Buffer }> {
  const info = await p.evaluate(
    ([l, f, v, g]) => {
      const api: { render(l: string, f: string, v: string, g: string): RenderInfo } = Reflect.get(window, 'T');
      return api.render(l, f, v, g);
    },
    [line, font, variant, gran] as const,
  );
  return { info, png: await shot(p, clip) };
}

interface Row {
  gran: Granularity;
  line: string;
  font: FontKey;
  variant: Variant;
  diff: Omit<Diff, 'bboxA' | 'bboxB'> & { bboxA: BBox; bboxB: BBox };
  /** max over units of max(|Δleft|, |Δright|) vs the unit's rect in the unsplit text, px */
  unitShiftMax: number;
  unitShiftMean: number;
  /** rendered content width minus unsplit content width, px */
  widthDelta: number;
  /** visual positions whose unit differs from the unsplit text's visual order */
  orderErrors: number;
}

const rows: Row[] = [];
const nativeVsBidi: { gran: Granularity; line: string; font: FontKey; mismatches: number; native: string; bidi: string }[] = [];
const sheets: Record<string, { label: string; cells: Cell[]; overlays: Cell[] }[]> = { grapheme: [], word: [] };
const t0 = performance.now();

const extent = (i: RenderInfo) => Math.max(...i.units.map((u) => u.rect[1])) - Math.min(...i.units.map((u) => u.rect[0]));
for (const gran of GRANS)
  for (const line of LINES)
    for (const font of FONT_KEYS) {
      const ref = await render(page, line.id, font, 'plain', gran);
      nativeVsBidi.push({
        gran,
        line: line.id,
        font,
        mismatches: ref.info.order.filter((u, i) => u !== ref.info.bidiOrder[i]).length,
        native: ref.info.order.map((i) => ref.info.units[i].text).join('|'),
        bidi: ref.info.bidiOrder.map((i) => ref.info.units[i].text).join('|'),
      });
      const pngs: Buffer[] = [ref.png];
      const boxes: BBox[] = [];
      const overlays: Buffer[] = [];
      for (const variant of SPLITS) {
        const got = await render(page, line.id, font, variant, gran);
        const diff = await env.analyzer.diff(ref.png, got.png);
        boxes.push(diff.bboxA, diff.bboxB);
        const shifts = got.info.units.map((u, i) => {
          const r = ref.info.units[i].rect;
          return Math.max(Math.abs(u.rect[0] - r[0]), Math.abs(u.rect[1] - r[1]));
        });
        rows.push({
          gran,
          line: line.id,
          font,
          variant,
          diff,
          unitShiftMax: r2(Math.max(...shifts)),
          unitShiftMean: r2(shifts.reduce((x, y) => x + y, 0) / shifts.length),
          widthDelta: r2(extent(got.info) - extent(ref.info)),
          orderErrors: got.info.order.filter((u, i) => u !== ref.info.order[i]).length,
        });
        pngs.push(got.png);
        overlays.push(await env.analyzer.overlay(ref.png, got.png));
      }
      const crop = unionBox(boxes, 14, { w: STAGE.width, h: STAGE.height });
      sheets[gran].push({ label: `${line.id}\n${font}`, cells: pngs.map((png) => ({ png, crop })), overlays: overlays.map((png) => ({ png, crop })) });
    }
const elapsed = performance.now() - t0;

const evidence: string[] = [];
for (const gran of GRANS) {
  const g = sheets[gran];
  evidence.push(
    writeOut(
      `dom-${gran}.png`,
      await env.analyzer.sheet({ title: `DOM ${gran} split, 96 px (columns: unsplit reference, then split strategies)`, scale: 0.35, cols: ['reference', ...SPLITS], rows: g.map((r) => ({ label: r.label, cells: r.cells })) }),
    ),
    writeOut(
      `dom-${gran}-overlay.png`,
      await env.analyzer.sheet({ title: `DOM ${gran} split vs unsplit: red = unsplit only, cyan = split only, black = both`, scale: 0.35, cols: SPLITS, rows: g.map((r) => ({ label: r.label, cells: r.overlays })) }),
    ),
  );
}
const zoom = sheets.grapheme.filter((r) => /^niqqud|^geresh|^finals/.test(r.label));
evidence.push(
  writeOut(
    'dom-niqqud-zoom.png',
    await env.analyzer.sheet({
      title: 'Niqqud / geresh / finals at 1:1 — plain, inline-block graphemes, measured-absolute graphemes, overlays',
      scale: 1,
      cols: ['plain', 'ib', 'abs', 'overlay plain/ib', 'overlay plain/abs'],
      rows: zoom.map((r) => ({ label: r.label, cells: [r.cells[0], r.cells[1 + col('ib')], r.cells[1 + col('abs')], r.overlays[col('ib')], r.overlays[col('abs')]] })),
    }),
  ),
);

writeOut('dom.json', JSON.stringify({ rows, nativeVsBidi, elapsedMs: Math.round(elapsed) }, null, 1));

// ---- summary ----
console.log(`DOM spike: ${rows.length} split renders in ${Math.round(elapsed)} ms; page errors: ${pageErrors(page).length}`);
console.log('\ngran      variant  maxDiff%ink  meanDiff%ink  maxAlignedDiff%  maxBboxShift  maxUnitShift  maxWidthΔ  orderErrors(total)  linesWithOrderErrors');
for (const gran of GRANS)
  for (const variant of SPLITS) {
    const rs = rows.filter((r) => r.gran === gran && r.variant === variant);
    const mx = (f: (r: Row) => number) => r2(Math.max(...rs.map(f)));
    console.log(
      [
        gran.padEnd(9),
        variant.padEnd(8),
        String(mx((r) => r.diff.diffPctInk)).padStart(11),
        String(r2(rs.reduce((s, r) => s + r.diff.diffPctInk, 0) / rs.length)).padStart(13),
        String(mx((r) => r.diff.alignedDiffPctInk)).padStart(16),
        String(mx((r) => r.diff.bboxShift)).padStart(13),
        String(mx((r) => r.unitShiftMax)).padStart(13),
        String(mx((r) => Math.abs(r.widthDelta))).padStart(10),
        String(rs.reduce((s, r) => s + r.orderErrors, 0)).padStart(19),
        [...new Set(rs.filter((r) => r.orderErrors).map((r) => r.line))].join(','),
      ].join(' '),
    );
  }
console.log('\nper line (grapheme ib / isok / abs, word ib / abs): diff%ink, unitShiftMax px, widthΔ px');
for (const line of LINES)
  for (const font of FONT_KEYS) {
    const pick = (g: Granularity, v: Variant) => rows.find((r) => r.gran === g && r.variant === v && r.line === line.id && r.font === font)!;
    const fmt = (r: Row) => `${r1(r.diff.diffPctInk)}% ${r.unitShiftMax}px w${r.widthDelta}${r.orderErrors ? ` ORDER×${r.orderErrors}` : ''}`;
    console.log(`${line.id.padEnd(9)} ${font.padEnd(6)} | g-ib ${fmt(pick('grapheme', 'ib'))} | g-isok ${fmt(pick('grapheme', 'isok'))} | g-abs ${fmt(pick('grapheme', 'abs'))} | w-ib ${fmt(pick('word', 'ib'))} | w-abs ${fmt(pick('word', 'abs'))}`);
  }
console.log('\nbrowser-native vs bidi-js visual order (unit positions that differ):');
for (const n of nativeVsBidi) if (n.font === 'rubik') console.log(`${n.gran.padEnd(9)} ${n.line.padEnd(9)} mismatches=${n.mismatches}${n.mismatches ? `\n  native ${n.native}\n  bidi   ${n.bidi}` : ''}`);
console.log('\nevidence:', evidence.join('\n  '));
await env.close();
