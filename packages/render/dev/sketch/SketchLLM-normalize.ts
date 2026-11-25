/**
 * P0 spike S1 — candidates for the P3 `normalize()` and `joinToSingleLine()` steps
 * (out/sketch/BRIEF.md, Generators). Pure: arithmetic only (+ − × ÷ sqrt), no clock, no randomness.
 * Not product code. P3 moves a reviewed copy into the server.
 */
import type { Point, SketchDoc, Stroke } from './doc.ts';

const BOX = 1000;
/** Fraction of the shorter side left empty around the fitted drawing. 1000 → 40. */
const MARGIN_RATIO = 0.04;
/** Drop a source point further out than this; it is garbage, not a 1000-box coordinate. */
const SANE = 10_000;
const SKETCH_CAP = 80;
const LINE_CAP = 600;
const STROKE_CAP = 400;
const POINT_CAP = 6000;
/** Longest corner cut of the Chaikin pass, in source units (≈ the 1000 box), so a long straight edge stays crisp. */
const CUT_MAX = 20;
/** cos 60°: a turn at least this sharp is a deliberate corner that smoothing keeps. */
const KEEP_COS = 0.5;

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function dist2(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function lengthOf(pts: Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]);
  return n;
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

/** Arc-length resample. Endpoints are kept exactly. `max` includes both ends. */
function resample(pts: Point[], max: number): Point[] {
  if (pts.length <= max) return pts.map((p) => [p[0], p[1]] as Point);
  if (max < 2) return [];
  const mark: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]);
    mark.push(total);
  }
  if (total < 1e-9) return [pts[0]!, pts[pts.length - 1]!].map((p) => [p[0], p[1]] as Point);
  const out: Point[] = [];
  for (let k = 0; k < max; k++) {
    if (k === 0) {
      out.push([pts[0]![0], pts[0]![1]]);
      continue;
    }
    if (k === max - 1) {
      const last = pts[pts.length - 1]!;
      out.push([last[0], last[1]]);
      continue;
    }
    const target = (total * k) / (max - 1);
    let i = 1;
    while (i < mark.length - 1 && mark[i]! < target) i++;
    const t0 = mark[i - 1]!;
    const t1 = mark[i]!;
    const span = t1 - t0;
    const u = span < 1e-12 ? 0 : (target - t0) / span;
    const a = pts[i - 1]!;
    const b = pts[i]!;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

/**
 * Cut the corner at `p` (coming from `a`, going to `b`), pushing 1 or 2 points. Chaikin's cut sits 1/4 along
 * each side but never more than `CUT_MAX` units from `p`. A turn of 60° or more (cos ≤ `KEEP_COS`) is a
 * deliberate corner (a roof, a window) and is kept as is; LLM curves turn far less per point.
 */
function cutCorner(a: Point, p: Point, b: Point, out: Point[]): void {
  const ax = a[0] - p[0];
  const ay = a[1] - p[1];
  const bx = b[0] - p[0];
  const by = b[1] - p[1];
  const la = Math.sqrt(ax * ax + ay * ay);
  const lb = Math.sqrt(bx * bx + by * by);
  const turnCos = -(ax * bx + ay * by) / (la * lb);
  if (turnCos <= KEEP_COS) {
    out.push([p[0], p[1]]);
    return;
  }
  const ua = la * 0.25 <= CUT_MAX ? 0.25 : CUT_MAX / la;
  const ub = lb * 0.25 <= CUT_MAX ? 0.25 : CUT_MAX / lb;
  out.push([p[0] + ax * ua, p[1] + ay * ua]);
  out.push([p[0] + bx * ub, p[1] + by * ub]);
}

/** One light Chaikin pass (corner cutting) on an open polyline; endpoints and deliberate corners are kept. */
function chaikin(pts: Point[]): Point[] {
  const out: Point[] = [[pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length - 1; i++) cutCorner(pts[i - 1]!, pts[i]!, pts[i + 1]!, out);
  const last = pts[pts.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

/** The same on a loop whose last point repeats the first: the seam is a corner like any other; the result is closed again. */
function chaikinLoop(pts: Point[]): Point[] {
  const ring = pts.slice(0, -1);
  const n = ring.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) cutCorner(ring[(i + n - 1) % n]!, ring[i]!, ring[(i + 1) % n]!, out);
  out.push([out[0]![0], out[0]![1]]);
  return out;
}

/** A loop: at least a triangle whose last point repeats the first. */
function isLoop(pts: Point[]): boolean {
  const a = pts[0];
  const b = pts[pts.length - 1];
  return pts.length >= 4 && !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function cleanPoints(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const x = p[0];
    const y = p[1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(x) > SANE || Math.abs(y) > SANE) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === x && prev[1] === y) continue;
    out.push([x, y]);
  }
  return out;
}

function alive(pts: Point[]): boolean {
  return pts.length >= 2 && lengthOf(pts) > 1e-6;
}

function withStyle(pts: Point[], src: Stroke): Stroke {
  const s: Stroke = { pts };
  if (src.closed === true && pts.length >= 3) s.closed = true;
  if (typeof src.w === 'number' && Number.isFinite(src.w) && src.w > 0 && src.w <= 20) s.w = Math.round(src.w * 100) / 100;
  return s;
}

function quantise(pts: Point[], w: number, h: number): Point[] {
  return dedupe(pts.map((p) => [clamp(Math.round(p[0]), 0, w), clamp(Math.round(p[1]), 0, h)] as Point));
}

function quantiseAlive(pts: Point[], w: number, h: number): Point[] | null {
  const q = dedupe(pts.map((p) => [clamp(Math.round(p[0]), 0, w), clamp(Math.round(p[1]), 0, h)] as Point));
  return alive(q) && lengthOf(q) >= 1 ? q : null;
}

function clampBox(box: [number, number]): [number, number] {
  const side = (n: number): number => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return BOX;
    const r = Math.round(n);
    return r < 1 || r > BOX ? BOX : r;
  };
  return [side(box[0]), side(box[1])];
}

function marginOf(w: number, h: number): number {
  let m = Math.round(Math.min(w, h) * MARGIN_RATIO);
  if (m * 2 >= Math.min(w, h)) m = Math.max(0, Math.floor((Math.min(w, h) - 1) / 2));
  return m;
}

function fit(strokes: Stroke[], w: number, h: number): Stroke[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.pts) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const bw = Math.max(maxX - minX, 0);
  const bh = Math.max(maxY - minY, 0);
  const margin = marginOf(w, h);
  const innerW = w - 2 * margin;
  const innerH = h - 2 * margin;
  const sx = bw < 1e-9 ? 0 : innerW / bw;
  const sy = bh < 1e-9 ? 0 : innerH / bh;
  const s = bw < 1e-9 && bh < 1e-9 ? 1 : bw < 1e-9 ? sy : bh < 1e-9 ? sx : Math.min(sx, sy);
  const ox = margin + (innerW - bw * s) / 2;
  const oy = margin + (innerH - bh * s) / 2;
  return strokes.map((stroke) =>
    withStyle(
      stroke.pts.map((p) => [ox + (p[0] - minX) * s, oy + (p[1] - minY) * s] as Point),
      stroke,
    ),
  );
}

function underBudget(strokes: Stroke[], budget: number, perStroke: number): Stroke[] {
  let guard = 0;
  let cur = strokes;
  const count = (): number => cur.reduce((n, s) => n + s.pts.length, 0);
  while (count() > budget && guard++ < 6) {
    const n = count();
    const scale = budget / n;
    cur = cur.map((s) => {
      const keep = Math.max(2, Math.min(perStroke, Math.floor(s.pts.length * scale)));
      return keep < s.pts.length ? withStyle(resample(s.pts, keep), s) : s;
    });
  }
  while (count() > budget && cur.length > 1) cur = cur.slice(0, -1);
  return cur;
}

/**
 * Validate and repair a doc into canonical geometry: clamp the box, drop degenerate strokes,
 * one light Chaikin pass when it stays inside the point cap (loops are smoothed across their seam),
 * fit into the box with a margin, quantise to integers. Sketch strokes are capped at 80 points, line strokes at 600.
 * A line doc with several strokes is still several strokes — call `joinToSingleLine` after.
 */
export function normalize(doc: SketchDoc): SketchDoc {
  const box = clampBox(doc.box);
  const mode = doc.mode === 'line' ? 'line' : 'sketch';
  const cap = mode === 'line' ? LINE_CAP : SKETCH_CAP;
  let strokes: Stroke[] = [];
  for (const src of doc.strokes) {
    const pts = cleanPoints(src.pts);
    if (!alive(pts)) continue;
    let next = pts;
    if (isLoop(next) && (next.length - 1) * 2 + 1 <= cap) next = chaikinLoop(next);
    else if (next.length >= 3 && next.length * 2 <= cap) next = chaikin(next);
    else if (next.length > cap) next = resample(next, cap);
    strokes.push(withStyle(next, src));
  }
  if (strokes.length > STROKE_CAP) strokes = strokes.slice(0, STROKE_CAP);
  if (strokes.length) strokes = fit(strokes, box[0], box[1]);
  strokes = strokes.flatMap((s) => {
    const q = quantiseAlive(s.pts, box[0], box[1]);
    if (!q) return [];
    const capped = q.length > cap ? quantiseAlive(resample(q, cap), box[0], box[1]) : q;
    return capped ? [withStyle(capped, s)] : [];
  });
  strokes = underBudget(strokes, POINT_CAP, cap).flatMap((s) => {
    const q = quantiseAlive(s.pts, box[0], box[1]);
    return q ? [withStyle(q, s)] : [];
  });
  return { v: 1, box, mode, strokes, meta: { ...doc.meta } };
}

/** A stroke's points as an explicit loop (last = first) when it is closed, else as written. */
function explicit(s: Stroke): Point[] {
  const pts = cleanPoints(s.pts);
  if (s.closed === true && pts.length >= 3 && !isLoop(pts)) pts.push([pts[0]![0], pts[0]![1]]);
  return pts;
}

/**
 * A part oriented for a pen at `end`: an open stroke is reversed when its far end is strictly nearer
 * (ties keep the written direction); a loop is entered at its vertex nearest the pen and walked once around.
 * `cost` is the squared connector length.
 */
function enter(raw: Point[], end: Point): { pts: Point[]; cost: number } {
  if (isLoop(raw)) {
    const ring = raw.slice(0, -1);
    let k = 0;
    for (let j = 1; j < ring.length; j++) if (dist2(end, ring[j]!) < dist2(end, ring[k]!)) k = j;
    return { pts: ring.slice(k).concat(ring.slice(0, k), [ring[k]!]), cost: dist2(end, ring[k]!) };
  }
  const fwd = dist2(end, raw[0]!);
  const back = dist2(end, raw[raw.length - 1]!);
  return back < fwd ? { pts: raw.slice().reverse(), cost: back } : { pts: raw, cost: fwd };
}

function lineDoc(doc: SketchDoc, chain: Point[]): SketchDoc {
  const [w, h] = clampBox(doc.box);
  const meta = { ...doc.meta };
  let pts = dedupe(chain);
  if (pts.length > LINE_CAP) pts = resample(pts, LINE_CAP);
  const q = quantise(pts, w, h);
  if (!alive(q)) return { v: 1, box: [w, h], mode: 'line', strokes: [], meta };
  const stroke: Stroke = { pts: q };
  const src = doc.strokes.find((s) => typeof s.w === 'number' && s.w > 0 && s.w <= 20);
  if (src?.w !== undefined) stroke.w = Math.round(src.w * 100) / 100;
  return { v: 1, box: [w, h], mode: 'line', strokes: [stroke], meta };
}

/**
 * Chain strokes in drawing order into the one polyline Line mode stores.
 * Each stroke is entered by `enter` (reversed, or a loop rotated) so its connector is as short as possible.
 * The pen does not lift: the connector is the segment between the two endpoints.
 */
export function joinToSingleLine(doc: SketchDoc): SketchDoc {
  const parts = doc.strokes.map(explicit).filter(alive);
  const chain: Point[] = parts.length ? parts[0]!.map((p) => [p[0], p[1]] as Point) : [];
  for (let i = 1; i < parts.length; i++) chain.push(...enter(parts[i]!, chain[chain.length - 1]!).pts.map((p) => [p[0], p[1]] as Point));
  return lineDoc(doc, chain);
}

/**
 * Spike alternative to `joinToSingleLine`: starts with the first stroke, then always continues with the
 * remaining stroke whose entry is nearest the pen (lowest index on a tie). Gives up drawing order for less travel.
 */
export function joinNearest(doc: SketchDoc): SketchDoc {
  const left = doc.strokes.map(explicit).filter(alive);
  const chain: Point[] = left.length ? left.shift()!.map((p) => [p[0], p[1]] as Point) : [];
  while (left.length) {
    const end = chain[chain.length - 1]!;
    let best = 0;
    let pick = enter(left[0]!, end);
    for (let i = 1; i < left.length; i++) {
      const e = enter(left[i]!, end);
      if (e.cost < pick.cost) {
        best = i;
        pick = e;
      }
    }
    chain.push(...pick.pts.map((p) => [p[0], p[1]] as Point));
    left.splice(best, 1);
  }
  return lineDoc(doc, chain);
}
