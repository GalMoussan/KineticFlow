/**
 * Steps 3 + 4: morph every pair with every strategy; quality metrics, 12-frame contact sheets (Chromium),
 * per-pair setup cost, per-frame cost, determinism (seek order, rerun, Node vs Chromium).
 *   node spikes/morph/morph.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { frameRings, selfIntersections } from './geom.ts';
import { loadFonts, OUT, SPIKES } from './node-hb.ts';
import { PAIRS, STRATEGIES, buildSides, buildStrategy, type Built, type Strategy } from './pairs.ts';
import { openPage } from './www.ts';
import type {} from './page.ts';

const fonts = await loadFonts();
const T61 = Array.from({ length: 61 }, (_, i) => i / 60);
const T12 = Array.from({ length: 12 }, (_, i) => i / 11);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
const root = join(SPIKES, '..');

// deterministic shuffle (LCG) for seek-order test
function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function bboxOf(b: Built[]): [number, number, number, number] {
  const pts = b.flatMap((x) => x.rings.flat());
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - 12, Math.min(...ys) - 12, Math.max(...xs) + 12, Math.max(...ys) + 12];
}

type Row = {
  pair: string;
  strategy: string;
  error?: string;
  prepMs?: number;
  setupMs?: number;
  frameUs?: number;
  pathChars?: number;
  selfXFrames?: number;
  selfXMax?: number;
  maxStepPct?: number;
  endPopPct?: number;
  endsOffPct?: number;
  seekOrderIdentical?: boolean;
  rebuildIdentical?: boolean;
};
const rows: Row[] = [];
const hashes: Record<string, string> = {};
const sheets: { pair: string; html: string; w: number; h: number }[] = [];
const covJobs: { key: string; ds: string[]; exact: string[]; fill: 'nonzero' | 'evenodd'; box: [number, number, number, number] }[] = [];

for (const pair of PAIRS) {
  const prep: number[] = [];
  let sides = buildSides(fonts, pair);
  for (let r = 0; r < 15; r++) {
    const t0 = performance.now();
    sides = buildSides(fonts, pair);
    prep.push(performance.now() - t0);
  }
  const { A, B } = sides;
  const box = bboxOf([A, B]);
  const cellW = box[2] - box[0];
  const cellH = box[3] - box[1];
  const scale = Math.min(1, 150 / cellH, 260 / cellW);
  const sheetRows: string[] = [];
  for (const name of STRATEGIES) {
    const setups: number[] = [];
    let st: Strategy = buildStrategy(name, A, B, pair);
    for (let r = 0; r < 15 && st.frame; r++) {
      const t0 = performance.now();
      st = buildStrategy(name, A, B, pair);
      setups.push(performance.now() - t0);
    }
    const row: Row = { pair: pair.id, strategy: name };
    rows.push(row);
    if (!st.frame) {
      row.error = st.error ?? 'no frame';
      sheetRows.push(`<div class="row"><div class="lab">${name}<br><span class="err">${row.error.slice(0, 60)}</span></div></div>`);
      continue;
    }
    const frame = st.frame;
    // per-frame cost: scattered t (no caching benefit), 3000 frames
    let sink = 0;
    const N = 3000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) sink += frame((((i * 7919) % N) + 0.5) / N).length;
    row.prepMs = +median(prep).toFixed(3);
    row.setupMs = +median(setups).toFixed(3);
    row.frameUs = +(((performance.now() - t0) * 1000) / N).toFixed(1);
    row.pathChars = sink > 0 ? Math.round(sink / N) : 0;
    // determinism: sequential vs shuffled seek; fresh rebuild
    const seq = T61.map((t) => frame(t));
    const order = shuffled(
      T61.map((_, i) => i),
      1234,
    );
    const shuf: string[] = [];
    for (const i of order) shuf[i] = frame(T61[i]!);
    const fresh = buildStrategy(name, ...(Object.values(buildSides(fonts, pair)) as [Built, Built]), pair).frame!;
    row.seekOrderIdentical = seq.every((d, i) => d === shuf[i]);
    row.rebuildIdentical = seq.every((d, i) => d === fresh(T61[i]!));
    hashes[`${pair.id}/${name}`] = sha(seq.join('\n'));
    // twisting: self-crossings within rings over 59 interior frames
    const sx = seq.slice(1, -1).map((d) => selfIntersections(frameRings(d)));
    row.selfXFrames = sx.filter((n) => n > 0).length;
    row.selfXMax = Math.max(...sx);
    covJobs.push({ key: `${pair.id}/${name}`, ds: [...seq, frame(0.002), frame(0.998)], exact: [A.d, B.d], fill: st.fill, box });
    const cells = T12.map((t) => {
      const d = frame(t);
      return `<svg width="${(cellW * scale).toFixed(0)}" height="${(cellH * scale).toFixed(0)}" viewBox="${box[0]} ${box[1]} ${cellW} ${cellH}"><path fill="#111" fill-rule="${st.fill}" d="${d}"/><text x="${box[0] + 4}" y="${box[1] + 14}" font-size="${12 / scale}" fill="#c00" font-family="sans-serif">${t.toFixed(2)}</text></svg>`;
    }).join('');
    sheetRows.push(`<div class="row"><div class="lab">${name}<br><small>${st.fill}${st.note ? '; ' + st.note : ''}</small></div>${cells}</div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font:13px sans-serif}.row{display:flex;align-items:center;border-bottom:1px solid #ddd}.lab{width:190px;flex:none;padding:4px}svg{border-left:1px solid #eee}.err{color:#c00}h3{margin:6px}</style><h3>${pair.id}: ${pair.kind}</h3>${sheetRows.join('')}`;
  sheets.push({ pair: pair.id, html, w: Math.ceil(190 + 12 * (cellW * scale + 1)) + 4, h: 40 + STRATEGIES.length * Math.ceil(cellH * scale + 2) });
}

// ---------- browser: contact sheets, coverage continuity, hashes + perf in Chromium ----------
const { browser, page, close } = await openPage();
const sheetPaths: Record<string, string> = {};
for (const s of sheets) {
  const p = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  await p.setContent(s.html);
  const file = join(OUT, `sheet-${s.pair}.png`);
  await p.screenshot({ path: file, fullPage: true });
  await p.close();
  sheetPaths[s.pair] = relative(root, file);
}
for (const job of covJobs) {
  const cov = await page.evaluate(([ds, fill, box]) => window.M.coverage(ds, fill, box), [job.ds, job.fill, job.box] as const);
  const seq = cov.slice(0, 61);
  const mean = seq.reduce((a, b) => a + b, 0) / seq.length;
  let maxStep = 0;
  for (let i = 1; i < seq.length; i++) maxStep = Math.max(maxStep, Math.abs(seq[i]! - seq[i - 1]!));
  const endPop = Math.max(Math.abs(cov[61]! - seq[0]!), Math.abs(seq[60]! - cov[62]!));
  // do frame(0) / frame(1) actually equal the real outlines? (catches dropped holes / contours at the hand-off)
  const ex = await page.evaluate(([ds, box]) => window.M.coverage(ds, 'nonzero', box), [job.exact, job.box] as const);
  const endsOff = Math.max(Math.abs(seq[0]! - ex[0]!) / ex[0]!, Math.abs(seq[60]! - ex[1]!) / ex[1]!);
  const row = rows.find((r) => `${r.pair}/${r.strategy}` === job.key)!;
  row.maxStepPct = +((100 * maxStep) / mean).toFixed(2);
  row.endPopPct = +((100 * endPop) / mean).toFixed(2);
  row.endsOffPct = +(100 * endsOff).toFixed(2);
}
const browserHashes = await page.evaluate((ts) => window.M.morphHashes(ts), T61);
const browserPerf = await page.evaluate(() => window.M.benchMorph(9, 1500));
// Are transcendental Math functions bit-identical between Node's V8 and Chromium's V8?
const MATH_PROBE = `(() => { const out = {}; for (const f of ['sin','cos','atan2','exp','log','pow','sqrt','hypot']) { const a = []; let x = 0.1234; for (let i = 0; i < 20000; i++) { x = ((x * 9301 + 49297) % 233280) / 233280 * 20 - 10; a.push(f === 'atan2' || f === 'pow' || f === 'hypot' ? Math[f](x, x * 0.37 + 1) : Math[f](f === 'log' || f === 'sqrt' ? Math.abs(x) : x)); } out[f] = a.join(','); } return out; })()`;
const mathNode = (0, eval)(MATH_PROBE) as Record<string, string>;
const mathChrome = (await page.evaluate(MATH_PROBE)) as Record<string, string>;
const mathDiffer = Object.keys(mathNode).filter((k) => mathNode[k] !== mathChrome[k]);
const chromeVersion = browser.version();
await close();

// ---------- determinism across runs / environments ----------
const hashFile = join(OUT, 'morph-hashes.json');
type HashFile = { node: Record<string, string>; chrome: Record<string, string> };
const prev: HashFile | null = existsSync(hashFile) ? JSON.parse(readFileSync(hashFile, 'utf8')) : null;
writeFileSync(hashFile, JSON.stringify({ node: hashes, chrome: browserHashes } satisfies HashFile, null, 1));
const keys = Object.keys(hashes);
const cmp = (a: Record<string, string>, b: Record<string, string> | undefined) => {
  const shared = keys.filter((k) => b?.[k] !== undefined);
  return { same: shared.filter((k) => a[k] === b![k]).length, compared: shared.length };
};
const crossRun = prev?.node && prev.chrome ? { node: cmp(hashes, prev.node), chrome: cmp(browserHashes, prev.chrome) } : null;
const nodeVsChrome = keys.filter((k) => browserHashes[k] === hashes[k]);
const differ = keys.filter((k) => browserHashes[k] !== hashes[k]);

for (const r of rows) {
  const bp = browserPerf[`${r.pair}/${r.strategy}`];
  console.log(
    `${r.pair.padEnd(24)} ${r.strategy.padEnd(25)} ` +
      (r.error
        ? `ERROR ${r.error.slice(0, 70)}`
        : `prep ${r.prepMs}ms setup ${r.setupMs}ms frame ${r.frameUs}µs (chrome setup ${bp?.setupMs.toFixed(2)}ms frame ${bp?.frameUs.toFixed(1)}µs) chars ${r.pathChars} ` +
          `selfX frames ${r.selfXFrames}/59 max ${r.selfXMax} | maxStep ${r.maxStepPct}% endPop ${r.endPopPct}% endsOff ${r.endsOffPct}% | seek ${r.seekOrderIdentical} rebuild ${r.rebuildIdentical}`),
  );
}
console.log(
  `cross-run identical: ${crossRun ? `node ${crossRun.node.same}/${crossRun.node.compared}, chrome ${crossRun.chrome.same}/${crossRun.chrome.compared}` : 'n/a (first run; rerun to compare)'}`,
);
console.log(`Node ${process.versions.v8} vs Chromium ${chromeVersion} identical: ${nodeVsChrome.length}/${keys.length}; differ: ${differ.join(', ') || 'none'}`);
console.log(`Math functions that differ bitwise Node vs Chromium: ${mathDiffer.join(', ') || 'none'}`);
writeFileSync(
  join(OUT, 'morph.json'),
  JSON.stringify({ rows, browserPerf, sheets: sheetPaths, crossRun, keys: keys.length, nodeVsChromeIdentical: nodeVsChrome.length, differ, mathDiffer, chromeVersion }, null, 1),
);
console.log('sheets:', Object.values(sheetPaths).join(' '));
