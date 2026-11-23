/**
 * M0c troika-three-text: niqqud mark placement, bidi order, per-glyph access, latency, frame cost.
 * Stock troika 0.52.5 vs the same build with troika-patch.ts (RTL flip fix) applied at bundle time.
 * Run: node spikes/text/troika.ts   → out/troika.json, out/troika*.png, summary on stdout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import hbPromise from 'harfbuzzjs';
import { LINES } from './strings.ts';
import { parseEmphasis } from './units.ts';
import { ensureStaticFonts, STATIC_DIR } from './fonts.ts';
import { troikaFlipPatch } from './troika-patch.ts';
import type { TFontKey, TMode } from './troika-page.ts';
import { bundle, openPage, pageErrors, r1, r2, shot, start, unionBox, writeOut, type BBox, type Cell, type Diff } from './harness.ts';

const STAGE = { width: 2600, height: 240 };
const clip = { x: 0, y: 0, ...STAGE };
const FONTS: TFontKey[] = ['noto400', 'rubik400'];
type Engine = 'stock' | 'patched';
/** Columns: troika modes on both engines, then the Canvas2D modes (engine-independent). */
const COLS: { engine: Engine; mode: TMode; label: string }[] = [
  { engine: 'stock', mode: 'line', label: 'line' },
  { engine: 'stock', mode: 'g-troika', label: 'g-troika' },
  { engine: 'stock', mode: 'g-dom', label: 'g-dom' },
  { engine: 'patched', mode: 'line', label: 'line+patch' },
  { engine: 'patched', mode: 'g-troika', label: 'g-troika+patch' },
  { engine: 'patched', mode: 'g-dom', label: 'g-dom+patch' },
  { engine: 'stock', mode: 'g-canvas', label: 'g-canvas' },
  { engine: 'stock', mode: 'canvas', label: 'canvas' },
];
const HEBREW_ONLY = ['niqqud', 'niqqud2', 'geresh', 'finals', 'emphasis'];
const FONT_FILES: Record<TFontKey, string> = {
  noto400: join(STATIC_DIR, 'NotoSansHebrew-400.ttf'),
  rubik400: join(STATIC_DIR, 'Rubik-400.ttf'),
  notoVar: join(import.meta.dirname, '..', 'fonts', 'NotoSansHebrew.ttf'),
  rubikVar: join(import.meta.dirname, '..', 'fonts', 'Rubik.ttf'),
};

ensureStaticFonts();
await bundle('troika-page.ts');
await bundle('troika-page.ts', { outName: 'troika-page-patched', plugins: [troikaFlipPatch] });
const env = await start();

type TroikaResult = { msSync: number; msFirstFrame: number; timings?: Record<string, unknown>; glyphs?: number; units?: number; dir: string };
type Access = { renderableGlyphs: number; chars: number; caretEntries: number; textRenderInfoKeys: string[]; geometryAttributes: string[]; marks: { char: string; base: string; onBase: boolean }[] };
type Api = {
  showDom(l: string, f: TFontKey): number;
  troika(l: string, f: TFontKey, m: TMode, batched?: boolean): Promise<TroikaResult>;
  bench(frames: number): { frames: number; units: number; meanMs: number; p95Ms: number; maxMs: number };
  raw(l: string, f: TFontKey): Promise<{ dir: string; glyphIds: number[]; positions: number[] }>;
  access(l: string, f: TFontKey): Promise<Access>;
  probeText(text: string, f: TFontKey): Promise<number>;
};
/** Calls `window.T[method](...args)` inside the page (the page global is untyped from Node). */
function call<K extends keyof Api>(p: Page, method: K, ...args: Parameters<Api[K]>): Promise<Awaited<ReturnType<Api[K]>>> {
  return p.evaluate(
    ([m, a]) => {
      const api = Reflect.get(window, 'T');
      return api[m](...a);
    },
    [method, args] as const,
  );
}
const newPage = (engine: Engine, query = '') =>
  openPage(env.browser, `${env.url}/text/build/${engine === 'stock' ? 'troika-page' : 'troika-page-patched'}.html${query}`, STAGE);
const showDom = async (p: Page, l: string, f: TFontKey) => {
  await call(p, 'showDom', l, f);
  return shot(p, clip);
};
const troika = async (p: Page, l: string, f: TFontKey, m: TMode, batched = true) => {
  const timer = Promise.withResolvers<never>();
  const id = setTimeout(() => timer.reject(new Error(`troika ${l}/${f}/${m} did not sync within 30 s: ${pageErrors(p).slice(-2).join(' | ')}`)), 30_000);
  const res = await Promise.race([call(p, 'troika', l, f, m, batched), timer.promise]).finally(() => clearTimeout(id));
  return { res, png: await shot(p, clip) };
};

// ---- 0. CSP hazards: does Text.sync() ever resolve? ----
async function cspCheck(query: string, run: (p: Page) => Promise<number>) {
  const p = await newPage('stock', query);
  const timeout = 10_000;
  const outcome = await Promise.race([
    run(p)
      .then((ms) => `synced in ${r2(ms)} ms`)
      .catch((e: unknown) => `error: ${String(e).split('\n')[0]}`),
    new Promise<string>((r) => setTimeout(() => r(`Text.sync() did not resolve within ${timeout} ms`), timeout)),
  ]);
  const errs = pageErrors(p);
  await p.close();
  return { outcome, consoleErrors: errs.length, firstError: errs[0]?.split('\n')[0] };
}
/** troika's default (worker) mode */
const workerCheck = await cspCheck('?worker', (p) => call(p, 'troika', 'niqqud', 'noto400', 'line').then((r) => r.msSync));
/** main-thread mode, text with a codepoint the font lacks (U+202D LRO / U+202C PDF) */
const missingGlyphCheck = await cspCheck('', (p) => call(p, 'probeText', '\u202Dשלום\u202C', 'noto400'));

// ---- 1. cold first render, per font, fresh page each (useWorker:false) ----
const cold: Record<string, TroikaResult & { secondSameTextMs: number; newTextSameFontMs: number }> = {};
for (const f of FONTS) {
  const p = await newPage('stock');
  const first = await troika(p, 'niqqud', f, 'line');
  const again = await troika(p, 'niqqud', f, 'line');
  const other = await troika(p, 'finals', f, 'line');
  cold[f] = { ...first.res, secondSameTextMs: again.res.msFirstFrame, newTextSameFontMs: other.res.msFirstFrame };
  await p.close();
}

// ---- 2. DOM reference vs WebGL modes ----
const pages: Record<Engine, Page> = { stock: await newPage('stock'), patched: await newPage('patched') };
interface Row {
  line: string;
  font: TFontKey;
  col: string;
  diff: Diff;
  msSync: number;
  msFirstFrame: number;
}
const rows: Row[] = [];
const sheetRows: { label: string; cells: Cell[]; overlays: Cell[] }[] = [];
for (const line of LINES)
  for (const font of FONTS) {
    const ref = await showDom(pages.stock, line.id, font);
    const pngs = [ref];
    const overlays: Buffer[] = [];
    const boxes: BBox[] = [];
    for (const c of COLS) {
      const got = await troika(pages[c.engine], line.id, font, c.mode);
      const diff = await env.analyzer.diff(ref, got.png);
      boxes.push(diff.bboxA, diff.bboxB);
      rows.push({ line: line.id, font, col: c.label, diff, msSync: r2(got.res.msSync), msFirstFrame: r2(got.res.msFirstFrame) });
      pngs.push(got.png);
      overlays.push(await env.analyzer.overlay(ref, got.png));
    }
    const crop = unionBox(boxes, 14, { w: STAGE.width, h: STAGE.height });
    sheetRows.push({ label: `${line.id}\n${font}`, cells: pngs.map((png) => ({ png, crop })), overlays: overlays.map((png) => ({ png, crop })) });
  }

// ---- 3. variable font files: troika renders the default instance ----
const varRows: { font: TFontKey; line: string; inkRatioVsDom400: number; diffPctInk: number }[] = [];
const varCells: { label: string; cells: Cell[] }[] = [];
for (const font of ['notoVar', 'rubikVar'] as TFontKey[]) {
  const ref = await showDom(pages.patched, 'finals', font);
  const got = await troika(pages.patched, 'finals', font, 'line');
  const d = await env.analyzer.diff(ref, got.png);
  varRows.push({ font, line: 'finals', inkRatioVsDom400: r2(d.inkB / d.inkA), diffPctInk: r2(d.diffPctInk) });
  const crop = unionBox([d.bboxA, d.bboxB], 14, { w: STAGE.width, h: STAGE.height });
  varCells.push({ label: `${font}\nDOM 400 / troika`, cells: [{ png: ref, crop }, { png: got.png, crop }] });
}

// ---- 4. GPOS: troika glyph origins vs HarfBuzz (what Chromium shapes with) ----
const hb = await hbPromise;
interface GposRow {
  engine: Engine;
  line: string;
  font: TFontKey;
  troikaGlyphs: number;
  hbGlyphs: number;
  matched: number;
  baseMaxDx: number;
  markMaxDx: number;
  markMaxDy: number;
  marksOff: number;
  marks: number;
  worst: string;
}
const gpos: GposRow[] = [];
for (const font of FONTS) {
  const face = hb.createFace(hb.createBlob(readFileSync(FONT_FILES[font])), 0);
  const hbFont = hb.createFont(face);
  const scale = 96 / face.upem;
  for (const id of HEBREW_ONLY) {
    const text = parseEmphasis(LINES.find((l) => l.id === id)!.source).text;
    const buf = hb.createBuffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(hbFont, buf);
    const out: { g: number; cl: number; ax: number; dx: number; dy: number }[] = buf.json();
    buf.destroy();
    let pen = 0;
    const hbVisual = out.map((g) => {
      const o = { g: g.g, x: (pen + g.dx) * scale, y: g.dy * scale, mark: g.ax === 0, ch: text[g.cl] };
      pen += g.ax;
      return o;
    });
    const hbLogical = hbVisual.reverse().filter((g) => !/\s/.test(g.ch));
    for (const engine of ['stock', 'patched'] as Engine[]) {
      const raw = await call(pages[engine], 'raw', id, font);
      const tr = raw.glyphIds.map((g, i) => ({ g, x: raw.positions[i * 2], y: raw.positions[i * 2 + 1] }));
      // align greedily by glyph id (mark order inside a cluster may differ: HarfBuzz sorts marks canonically)
      const pairs: [(typeof tr)[number], (typeof hbLogical)[number]][] = [];
      let j = 0;
      for (const t of tr) {
        const k = hbLogical.findIndex((h, idx) => idx >= j && idx < j + 4 && h.g === t.g);
        if (k < 0) continue;
        pairs.push([t, hbLogical[k]]);
        if (k === j) j++;
      }
      const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
      const ox = median(pairs.filter(([, h]) => !h.mark).map(([t, h]) => t.x - h.x));
      const oy = median(pairs.map(([t, h]) => t.y - h.y));
      const dev = pairs.map(([t, h]) => ({ dx: t.x - h.x - ox, dy: t.y - h.y - oy, mark: h.mark, g: h.g }));
      const marks = dev.filter((d) => d.mark);
      const worst = [...marks].sort((a, b) => Math.abs(b.dx) - Math.abs(a.dx))[0];
      gpos.push({
        engine,
        line: id,
        font,
        troikaGlyphs: tr.length,
        hbGlyphs: hbLogical.length,
        matched: pairs.length,
        baseMaxDx: r2(Math.max(0, ...dev.filter((d) => !d.mark).map((d) => Math.abs(d.dx)))),
        markMaxDx: r2(Math.max(0, ...marks.map((d) => Math.abs(d.dx)))),
        markMaxDy: r2(Math.max(0, ...marks.map((d) => Math.abs(d.dy)))),
        marksOff: marks.filter((d) => Math.abs(d.dx) > 2 || Math.abs(d.dy) > 2).length,
        marks: marks.length,
        worst: worst ? `gid ${worst.g} dx ${r1(worst.dx)} dy ${r1(worst.dy)}` : '-',
      });
    }
  }
}

// ---- 5. per-glyph access ----
const access = { niqqud: await call(pages.patched, 'access', 'niqqud', 'noto400'), mixed: await call(pages.patched, 'access', 'mixed', 'noto400') };

// ---- 6. steady per-frame cost (mixed line, 35 non-space graphemes) ----
const bench: Record<string, unknown>[] = [];
for (const font of FONTS)
  for (const [mode, batched] of [['line', true], ['g-dom', true], ['g-dom', false], ['g-canvas', false], ['canvas', true]] as [TMode, boolean][]) {
    const r = await troika(pages.patched, 'mixed', font, mode, batched);
    await call(pages.patched, 'bench', 20); // warm-up
    const b = await call(pages.patched, 'bench', 240);
    bench.push({ font, mode: `${mode}${mode.startsWith('g-') ? (batched ? ' (BatchedText)' : ' (separate meshes)') : ''}`, setupMs: r2(r.res.msFirstFrame), ...b, meanMs: r2(b.meanMs), p95Ms: r2(b.p95Ms), maxMs: r2(b.maxMs) });
  }
const errors = [...pageErrors(pages.stock), ...pageErrors(pages.patched)];

// ---- evidence ----
const colIdx = (label: string) => COLS.findIndex((c) => c.label === label);
const ZOOM = ['line', 'g-dom', 'line+patch', 'g-dom+patch', 'g-canvas'];
const evidence = [
  writeOut('troika.png', await env.analyzer.sheet({ title: 'WebGL vs DOM reference (static wght-400 instances, 96 px)', scale: 0.3, cols: ['DOM', ...COLS.map((c) => c.label)], rows: sheetRows.map((r) => ({ label: r.label, cells: r.cells })) })),
  writeOut('troika-overlay.png', await env.analyzer.sheet({ title: 'DOM (red) vs WebGL (cyan); black = both', scale: 0.3, cols: COLS.map((c) => c.label), rows: sheetRows.map((r) => ({ label: r.label, cells: r.overlays })) })),
  writeOut(
    'troika-niqqud-zoom.png',
    await env.analyzer.sheet({
      title: 'Niqqud at 1:1 — DOM, then WebGL modes; second half: overlays DOM (red) / WebGL (cyan)',
      scale: 1,
      cols: ['DOM', ...ZOOM, ...ZOOM.map((z) => `overlay ${z}`)],
      rows: sheetRows
        .filter((r) => /^niqqud/.test(r.label))
        .map((r) => ({ label: r.label, cells: [r.cells[0], ...ZOOM.map((z) => r.cells[1 + colIdx(z)]), ...ZOOM.map((z) => r.overlays[colIdx(z)])] })),
    }),
  ),
  writeOut('troika-varfont.png', await env.analyzer.sheet({ title: 'Variable font files: DOM wght 400 vs troika (default instance)', scale: 0.5, cols: ['DOM 400', 'troika'], rows: varCells })),
];
writeOut('troika.json', JSON.stringify({ workerCheck, missingGlyphCheck, cold, rows, varRows, gpos, access, bench, errors }, null, 1));
await env.close();

// ---- summary ----
console.log('default worker mode under production CSP:', JSON.stringify(workerCheck));
console.log('main-thread mode, codepoint missing from the font (U+202D/U+202C):', JSON.stringify(missingGlyphCheck));
console.log('cold first render (fresh page, line "niqqud", useWorker:false):');
for (const [f, c] of Object.entries(cold))
  console.log(
    `  ${f}: sync ${r1(c.msSync)} ms, first frame ${r1(c.msFirstFrame)} ms, same text again ${r1(c.secondSameTextMs)} ms, new text same font ${r1(c.newTextSameFontMs)} ms, troika timings ${JSON.stringify(c.timings, (k, v) => (typeof v === 'number' ? r1(v) : k === 'sdf' ? undefined : v))}`,
  );
console.log('\ncolumn           maxDiff%ink meanDiff%ink maxBboxShift meanSyncMs maxSyncMs  (DOM vs WebGL, all lines × 2 fonts)');
for (const c of COLS) {
  const rs = rows.filter((r) => r.col === c.label);
  const mean = (f: (r: Row) => number) => r2(rs.reduce((s, r) => s + f(r), 0) / rs.length);
  console.log(
    `${c.label.padEnd(16)} ${String(r2(Math.max(...rs.map((r) => r.diff.diffPctInk)))).padStart(11)} ${String(mean((r) => r.diff.diffPctInk)).padStart(12)} ${String(Math.max(...rs.map((r) => r.diff.bboxShift))).padStart(12)} ${String(mean((r) => r.msSync)).padStart(10)} ${String(r2(Math.max(...rs.map((r) => r.msSync)))).padStart(9)}`,
  );
}
console.log('\nper line: diff%ink / bboxShift px');
for (const line of LINES)
  for (const font of FONTS)
    console.log(
      `${line.id.padEnd(9)} ${font.padEnd(9)} ` +
        COLS.map((c) => {
          const r = rows.find((x) => x.line === line.id && x.font === font && x.col === c.label)!;
          return `${c.label} ${r1(r.diff.diffPctInk)}/${r.diff.bboxShift}`;
        }).join(' | '),
    );
console.log('\nGPOS: troika glyph origins vs HarfBuzz (px @96, after removing the median offset)');
for (const g of gpos)
  console.log(
    `${g.engine.padEnd(8)} ${g.line.padEnd(9)} ${g.font.padEnd(9)} glyphs t${g.troikaGlyphs}/hb${g.hbGlyphs} matched ${g.matched} | base max|dx| ${g.baseMaxDx} | marks ${g.marks}: max|dx| ${g.markMaxDx} max|dy| ${g.markMaxDy}, >2px off: ${g.marksOff} | worst ${g.worst}`,
  );
console.log('\nper-glyph access:');
for (const [k, a] of Object.entries(access))
  console.log(`  ${k}: renderable glyphs ${a.renderableGlyphs}, chars ${a.chars}, caret entries ${a.caretEntries}, marks with caret on base ${a.marks.filter((m) => m.onBase).length}/${a.marks.length}\n    textRenderInfo: ${a.textRenderInfoKeys.join(',')}\n    geometry attributes: ${a.geometryAttributes.join(',')}`);
console.log('\nvariable font files in troika:', JSON.stringify(varRows));
console.log('\nsteady per-frame cost (update all units + render + GPU sync), patched build:');
for (const b of bench) console.log(' ', JSON.stringify(b));
console.log(`\npage errors: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
console.log('evidence:\n  ' + evidence.join('\n  '));
