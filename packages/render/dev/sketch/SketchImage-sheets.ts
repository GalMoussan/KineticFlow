/**
 * Contact sheets for the S2 / S3 spikes. Reads SketchDoc JSON and draws it with plainSvg.
 * S2 progress sheet clips each single line at 25 / 50 / 75 % of arc length.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainSvg, pointCount, problems, type SketchDoc, type Point } from './doc.ts';
import { sheet, type Cell } from './sheet.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../../..');
const images = join(root, 'out/sketch/images');
const spikes = join(root, 'out/dev/sketch-spikes');

const IDS = ['logo', 'portrait', 'product', 'drawing', 'landscape'] as const;

function load(path: string): SketchDoc {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as SketchDoc;
  const bad = problems(doc);
  if (bad.length) throw new Error(`${path}: ${bad.join('; ')}`);
  return doc;
}

function svgOf(doc: SketchDoc): string {
  return plainSvg(doc, { stroke: '#16161c' });
}

function note(doc: SketchDoc): string {
  return `${doc.strokes.length} strokes · ${pointCount(doc)} pts · ${doc.meta.model ?? ''} · d${doc.meta.detail}`;
}

/** Prefix of the drawing, by arc length. Closed strokes include the edge back to the start. */
function clipArc(doc: SketchDoc, frac: number): SketchDoc {
  let total = 0;
  const lengths: number[] = [];
  for (const s of doc.strokes) {
    let length = 0;
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1]!;
      const b = s.pts[i]!;
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (s.closed && s.pts.length > 2) {
      const a = s.pts[0]!;
      const b = s.pts[s.pts.length - 1]!;
      length += Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    lengths.push(length);
    total += length;
  }
  let budget = total * frac;
  const strokes: SketchDoc['strokes'] = [];
  for (let si = 0; si < doc.strokes.length; si++) {
    const s = doc.strokes[si]!;
    if (budget <= 1e-6) break;
    const seq: Point[] = s.pts.map((p) => [p[0], p[1]]);
    if (s.closed && seq.length > 2) seq.push([seq[0]![0], seq[0]![1]]);
    const out: Point[] = [[seq[0]![0], seq[0]![1]]];
    let acc = 0;
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1]!;
      const b = seq[i]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + length <= budget + 1e-6) {
        const last = out[out.length - 1]!;
        if (last[0] !== b[0] || last[1] !== b[1]) out.push([b[0], b[1]]);
        acc += length;
      } else {
        const t = length > 0 ? (budget - acc) / length : 0;
        const x = Math.round(a[0] + (b[0] - a[0]) * t);
        const y = Math.round(a[1] + (b[1] - a[1]) * t);
        const last = out[out.length - 1]!;
        if (last[0] !== x || last[1] !== y) out.push([x === 0 ? 0 : x, y === 0 ? 0 : y]);
        acc = budget;
        break;
      }
    }
    if (out.length >= 2) {
      const stroke: SketchDoc['strokes'][number] = { pts: out };
      if (s.w != null) stroke.w = s.w;
      strokes.push(stroke);
    }
    budget -= acc;
  }
  if (!strokes.length) {
    const s = doc.strokes[0]!;
    strokes.push({ pts: s.pts.slice(0, 2).map((p) => [p[0], p[1]]), ...(s.w != null ? { w: s.w } : {}) });
  }
  return { ...doc, strokes };
}

async function main(): Promise<void> {
  const s3: Cell[] = [];
  for (const id of IDS) {
    s3.push({ label: id, src: join(images, id === 'logo' ? 'logo.png' : `${id}.jpg`), note: 'source' });
    for (const detail of [2, 3, 5] as const) {
      const doc = load(join(root, 'out/sketch/S3', `${id}-d${detail}.sketch.json`));
      s3.push({ label: `${id} · detail ${detail}`, svg: svgOf(doc), note: note(doc) });
    }
  }
  await sheet(join(spikes, 's3-sketch.png'), s3, { cols: 4, cell: 280, title: 'S3 image → sketch (XDoG) · source, detail 2, 3, 5' });

  const edges: Cell[] = [];
  const order: Cell[] = [];
  for (const id of IDS) {
    edges.push({ label: id, src: join(images, id === 'logo' ? 'logo.png' : `${id}.jpg`), note: 'source' });
    const xdog = load(join(root, 'out/sketch/S3', `${id}-d3.sketch.json`));
    const canny = load(join(root, 'out/sketch/S3/canny', `${id}-d3.sketch.json`));
    edges.push({ label: `${id} · XDoG d3`, svg: svgOf(xdog), note: note(xdog) });
    edges.push({ label: `${id} · Canny d3`, svg: svgOf(canny), note: note(canny) });
    for (const frac of [0.1, 0.25, 0.5, 1] as const) {
      order.push({ label: `${id} · d3 · ${frac * 100}%`, svg: svgOf(clipArc(xdog, frac)), note: frac === 1 ? note(xdog) : 'outline-first order' });
    }
  }
  await sheet(join(spikes, 's3-xdog-vs-canny.png'), edges, { cols: 3, cell: 300, title: 'S3 line extractor · source, XDoG, Canny (detail 3)' });
  await sheet(join(spikes, 's3-sketch-order.png'), order, { cols: 4, cell: 240, title: 'S3 drawing order · detail 3 at 10%, 25%, 50%, 100% of ink length' });

  const engines = [
    { key: 'matisse', label: 'spiralist matisse' },
    { key: 'contour', label: 'spiralist contour' },
    { key: 'stipple', label: 'own stipple tour' },
    { key: 'chain', label: 'own hybrid: sketch chain' },
  ] as const;
  const s2: Cell[] = [];
  const progress: Cell[] = [];
  for (const id of IDS) {
    s2.push({ label: id, src: join(images, id === 'logo' ? 'logo.png' : `${id}.jpg`), note: 'source' });
    for (const engine of engines) {
      const doc = load(join(root, 'out/sketch/S2', `${id}-${engine.key}.sketch.json`));
      s2.push({ label: `${id} · ${engine.label}`, svg: svgOf(doc), note: note(doc) });
      for (const frac of [0.25, 0.5, 0.75, 1] as const) {
        progress.push({
          label: `${id} · ${engine.label} · ${frac * 100}%`,
          svg: svgOf(frac === 1 ? doc : clipArc(doc, frac)),
          note: frac === 1 ? `${pointCount(doc)} pts` : '',
        });
      }
    }
  }
  await sheet(join(spikes, 's2-line.png'), s2, {
    cols: 5,
    cell: 280,
    title: 'S2 image → one line · source, spiralist matisse, spiralist contour, own stipple tour, own hybrid (sketch strokes chained)',
  });
  await sheet(join(spikes, 's2-line-progress.png'), progress, {
    cols: 8,
    cell: 200,
    title: 'S2 drawing order · each line at 25 / 50 / 75 / 100 % of arc length (two engines per row)',
  });
  console.log('sheets written');
}

await main();
