import { contrast } from '@reel/core';

/**
 * Client-side logo processing before upload: flat-background removal by flood fill from the four corners, auto-trim,
 * and dominant colours (k-means, k = 5, on opaque pixels). SVG files bypass all of this.
 */

export interface LogoOptions {
  removeBackground: boolean;
  /** 0..100: how far a pixel may differ from the corner colour and still count as background. */
  tolerance: number;
  trim: boolean;
}

export interface ProcessedLogo {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  colors: string[];
  /** Fraction of pixels made transparent by background removal. */
  removed: number;
}

const MAX_SIDE = 1600;

export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(file);
  if (Math.max(bmp.width, bmp.height) <= MAX_SIDE) return bmp;
  const k = MAX_SIDE / Math.max(bmp.width, bmp.height);
  const scaled = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
  bmp.close();
  return scaled;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2D unavailable');
  return ctx;
}

export function processLogo(bmp: ImageBitmap, opts: LogoOptions): ProcessedLogo {
  const { width: w, height: h } = bmp;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const ctx = context(src);
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  let removed = 0;
  if (opts.removeBackground) removed = removeBackground(img, opts.tolerance);
  ctx.putImageData(img, 0, 0);
  const box = opts.trim ? opaqueBox(img) : { x: 0, y: 0, w, h };
  const out = document.createElement('canvas');
  out.width = Math.max(1, box.w);
  out.height = Math.max(1, box.h);
  context(out).drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { canvas: out, w: out.width, h: out.height, colors: dominantColors(img), removed };
}

/** Flood fill from each corner whose colour is opaque; returns the removed fraction. */
function removeBackground(img: ImageData, tolerance: number): number {
  const { data, width: w, height: h } = img;
  const thr = (tolerance / 100) * 160 + 4;
  const filled = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  let count = 0;
  const dist = (p: number, r: number, g: number, b: number) => {
    const o = p * 4;
    const dr = data[o]! - r;
    const dg = data[o + 1]! - g;
    const db = data[o + 2]! - b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  for (const seed of corners) {
    if (filled[seed] || data[seed * 4 + 3]! < 16) continue;
    const r = data[seed * 4]!;
    const g = data[seed * 4 + 1]!;
    const b = data[seed * 4 + 2]!;
    let top = 0;
    stack[top++] = seed;
    filled[seed] = 1;
    while (top > 0) {
      const p = stack[--top]!;
      count++;
      const x = p % w;
      const y = (p - x) / w;
      const visit = (q: number) => {
        if (filled[q]) return;
        if (data[q * 4 + 3]! < 16 || dist(q, r, g, b) <= thr) {
          filled[q] = 1;
          stack[top++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    // Soften the edge: pixels bordering the fill fade by their distance to the background colour (anti-aliasing).
    for (let p = 0; p < w * h; p++) {
      if (filled[p]) continue;
      const x = p % w;
      const near = (x > 0 && filled[p - 1]) || (x < w - 1 && filled[p + 1]) || (p >= w && filled[p - w]) || (p < w * (h - 1) && filled[p + w]);
      if (!near) continue;
      const d = dist(p, r, g, b);
      if (d < thr * 2.5) data[p * 4 + 3] = Math.round(data[p * 4 + 3]! * Math.min(1, Math.max(0, (d - thr) / (thr * 1.5))));
    }
  }
  for (let p = 0; p < w * h; p++) if (filled[p]) data[p * 4 + 3] = 0;
  return count / (w * h);
}

function opaqueBox(img: ImageData): { x: number; y: number; w: number; h: number } {
  const { data, width: w, height: h } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** k-means (k = 5) over opaque pixels, deterministic; centroids by cluster size, near-duplicates merged. */
export function dominantColors(img: ImageData, k = 5): string[] {
  const { data } = img;
  const total = data.length / 4;
  const step = Math.max(1, Math.floor(total / 6000));
  const pts: [number, number, number][] = [];
  for (let p = 0; p < total; p += step) {
    if (data[p * 4 + 3]! > 200) pts.push([data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!]);
  }
  if (!pts.length) return [];
  // Deterministic farthest-point initialisation.
  const cents: [number, number, number][] = [pts[0]!];
  const d2 = (a: readonly number[], b: readonly number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
  while (cents.length < Math.min(k, pts.length)) {
    let best = pts[0]!;
    let bestD = -1;
    for (const p of pts) {
      const d = Math.min(...cents.map((c) => d2(p, c)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (bestD <= 0) break;
    cents.push([...best]);
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 12; it++) {
    pts.forEach((p, i) => {
      let bi = 0;
      let bd = Infinity;
      cents.forEach((c, j) => {
        const d = d2(p, c);
        if (d < bd) {
          bd = d;
          bi = j;
        }
      });
      assign[i] = bi;
    });
    const sums = cents.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      const s = sums[assign[i]!]!;
      s[0]! += p[0];
      s[1]! += p[1];
      s[2]! += p[2];
      s[3]! += 1;
    });
    sums.forEach((s, j) => {
      if (s[3]) cents[j] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
  }
  const sizes = cents.map((_, j) => 0);
  assign.forEach((j) => sizes[j]!++);
  const order = cents.map((c, j) => ({ c, n: sizes[j]! })).sort((a, b) => b.n - a.n);
  const out: [number, number, number][] = [];
  for (const { c, n } of order) {
    if (n === 0) continue;
    if (out.some((o) => d2(o, c) < 24 * 24)) continue;
    out.push(c);
  }
  return out.map((c) => hex(c[0], c[1], c[2]));
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
  return promise;
}

// ---------- palette from logo colours ----------

function saturation(c: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

/** A readable palette from extracted logo colours on a light or dark background. */
export function paletteFromColors(colors: string[], background: 'light' | 'dark'): { bg: string; text: string; accents: string[] } {
  const bg = background === 'light' ? '#F7F4EE' : '#101014';
  const text = background === 'light' ? '#16161D' : '#FFFFFF';
  const accents = [...new Set(colors.map((c) => c.toUpperCase()))]
    .filter((c) => contrast(c, bg) >= 1.6)
    .sort((a, b) => saturation(b) - saturation(a))
    .slice(0, 5);
  return { bg, text, accents: accents.length ? accents : [text] };
}
