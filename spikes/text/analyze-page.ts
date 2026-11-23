/** Browser-side pixel analysis: PNG decode, ink diff, overlays, contact sheets. Bundled by harness.ts. */
import type { BBox, Diff, SheetSpec } from './harness.ts';

async function decode(b64: string): Promise<ImageData> {
  const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/** 0 = white paper, 255 = full ink. */
function inkMap(img: ImageData): Uint8Array {
  const d = img.data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = 255 - Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  return out;
}

const INK = 96;

function bbox(ink: Uint8Array, w: number, h: number): BBox {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ink[y * w + x] > INK) {
        if (x < x0) x0 = x;
        if (x >= x1) x1 = x + 1;
        if (y < y0) y0 = y;
        if (y >= y1) y1 = y + 1;
      }
  return [x0, y0, x1, y1];
}

function compare(a: Uint8Array, b: Uint8Array, w: number, h: number, t: number, dx: number, dy: number) {
  let diffPx = 0, inkUnion = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const va = a[y * w + x];
      const bx = x - dx, by = y - dy;
      const vb = bx >= 0 && by >= 0 && bx < w && by < h ? b[by * w + bx] : 0;
      if (va > INK || vb > INK) inkUnion++;
      if (Math.abs(va - vb) > t) diffPx++;
    }
  return { diffPx, inkUnion };
}

async function diff(a64: string, b64: string, t: number): Promise<Diff> {
  const [ia, ib] = await Promise.all([decode(a64), decode(b64)]);
  if (ia.width !== ib.width || ia.height !== ib.height) throw new Error('size mismatch');
  const { width: w, height: h } = ia;
  const a = inkMap(ia), b = inkMap(ib);
  const bboxA = bbox(a, w, h), bboxB = bbox(b, w, h);
  const raw = compare(a, b, w, h, t, 0, 0);
  const dx = Math.round((bboxA[0] + bboxA[2] - bboxB[0] - bboxB[2]) / 2);
  const dy = Math.round((bboxA[1] + bboxA[3] - bboxB[1] - bboxB[3]) / 2);
  const aligned = compare(a, b, w, h, t, dx, dy);
  let inkA = 0, inkB = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > INK) inkA++;
    if (b[i] > INK) inkB++;
  }
  return {
    w,
    h,
    inkA,
    inkB,
    diffPx: raw.diffPx,
    inkUnion: raw.inkUnion,
    diffPctInk: (raw.diffPx / Math.max(1, raw.inkUnion)) * 100,
    diffPctArea: (raw.diffPx / (w * h)) * 100,
    bboxA,
    bboxB,
    bboxShift: Math.max(...bboxA.map((v, i) => Math.abs(v - bboxB[i]))),
    alignedDiffPctInk: (aligned.diffPx / Math.max(1, aligned.inkUnion)) * 100,
  };
}

async function toB64(c: OffscreenCanvas): Promise<string> {
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function overlay(a64: string, b64: string): Promise<string> {
  const [ia, ib] = await Promise.all([decode(a64), decode(b64)]);
  const a = inkMap(ia), b = inkMap(ib);
  const c = new OffscreenCanvas(ia.width, ia.height);
  const ctx = c.getContext('2d')!;
  const out = ctx.createImageData(ia.width, ia.height);
  for (let i = 0; i < a.length; i++) {
    out.data[i * 4] = 255 - b[i];
    out.data[i * 4 + 1] = 255 - a[i];
    out.data[i * 4 + 2] = 255 - a[i];
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return toB64(c);
}

async function sheet(s: SheetSpec): Promise<string> {
  const LABEL_W = 260, HEAD = 70, GAP = 8;
  const decoded = await Promise.all(
    s.rows.map((r) => Promise.all(r.cells.map(async (c) => c && { bmp: await createImageBitmap(await (await fetch(`data:image/png;base64,${c.png}`)).blob()), crop: c.crop }))),
  );
  const colW = s.cols.map((_, ci) =>
    Math.max(120, ...decoded.map((r) => (r[ci] ? ((r[ci]!.crop ? r[ci]!.crop![2] - r[ci]!.crop![0] : r[ci]!.bmp.width) * s.scale) : 0))),
  );
  const rowH = decoded.map((r) => Math.max(30, ...r.map((c) => (c ? (c.crop ? c.crop[3] - c.crop[1] : c.bmp.height) * s.scale : 0))));
  const W = LABEL_W + colW.reduce((x, y) => x + y + GAP, 0);
  const H = HEAD + rowH.reduce((x, y) => x + y + GAP, 0);
  const c = new OffscreenCanvas(Math.ceil(W), Math.ceil(H));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ddd';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(s.title, 8, 26);
  ctx.font = '16px sans-serif';
  let x = LABEL_W;
  s.cols.forEach((label, ci) => {
    ctx.fillText(label, x + 4, 58);
    x += colW[ci] + GAP;
  });
  let y = HEAD;
  decoded.forEach((r, ri) => {
    ctx.fillStyle = '#000';
    ctx.font = '15px sans-serif';
    s.rows[ri].label.split('\n').forEach((t, li) => ctx.fillText(t, 6, y + 20 + li * 18));
    let x = LABEL_W;
    r.forEach((cell, ci) => {
      if (cell) {
        const [sx, sy, ex, ey] = cell.crop ?? [0, 0, cell.bmp.width, cell.bmp.height];
        ctx.drawImage(cell.bmp, sx, sy, ex - sx, ey - sy, x, y, (ex - sx) * s.scale, (ey - sy) * s.scale);
      }
      x += colW[ci] + GAP;
    });
    y += rowH[ri] + GAP;
  });
  return toB64(c);
}

Object.assign(window, { T: { ready: true, diff, overlay, sheet } });
