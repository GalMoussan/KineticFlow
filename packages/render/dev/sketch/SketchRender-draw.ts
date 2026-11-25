/**
 * P0 spike (S4/S5): page-side draw-on for one SketchDoc (out/sketch/BRIEF.md, "Rendering (page)").
 * SVG in the DOM only. A pure function of (doc, rect, p, t): no CSS animations, no Date, no Math.random.
 * Jitter uses `hash()` from `@reel/runtime` (`packages/runtime/src/math.ts`). Outlines: perfect-freehand 1.2.2 (MIT).
 *
 * Line mode:   `prefix` rebuilds the visible prefix's `d` (+ one interpolated point) every frame;
 *              `dash`   keeps one full path and sets `stroke-dasharray`/`stroke-dashoffset` every frame.
 * Sketch mode: `precompute` builds every stroke's outline (main + faint pass) at mount; per frame only the partial
 *              stroke is recomputed;
 *              `recompute`  rebuilds every visible outline every frame;
 *              `boil`       like `precompute`, but the faint pass's jitter changes every 4 frames (`floor(t·fps/4)`),
 *                           so completed strokes' faint outlines are rebuilt once per bucket.
 *              `boil-shift` same look as `boil`, but the faint outlines are built once and each bucket only rewrites
 *                           every faint path's `translate(jx jy)` (the jitter is a pure per-stroke offset).
 *
 * Every attribute/style this module ever sets is written on every `update` (a write is skipped only when the element
 * already holds exactly that value, which only this module writes), so a frame never depends on earlier seeks.
 */
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { hash } from '../../../runtime/src/math.ts';
import type { Point, SketchDoc, Stroke } from './doc.ts';

export type DrawApproach = 'prefix' | 'dash' | 'precompute' | 'recompute' | 'boil' | 'boil-shift';

export interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawSetup {
  doc: SketchDoc;
  /** An empty `<svg>` owned by the overlay; the module positions it absolutely inside its parent. */
  svg: SVGSVGElement;
  /** Screen rect the drawing is fitted into (aspect preserved, centred). */
  rect: TargetRect;
  overlayId: string;
  approach: DrawApproach;
  /** Pen-tip dot at the leading point. Default: on for line, off for sketch. */
  pen?: boolean;
  /** Line: stroke width; sketch: perfect-freehand `size`. Box units. Default: box/150 (line), box/90 (sketch). */
  width?: number;
  /** Faint-pass jitter amplitude in box units. Default: 1.2 % of the box. */
  rough?: number;
  /** `#RRGGBB`. */
  color?: string;
  fps?: number;
}

export interface DrawSession {
  /** Total arc length (hypot sums), box units. */
  total: number;
  /** Draws progress `p` ∈ [0, 1] at reel time `t` (t only matters for `boil`). */
  update(p: number, t: number): void;
}

const NS = 'http://www.w3.org/2000/svg';

const written = new WeakMap<Element, Map<string, string>>();

function setAttr(el: Element, name: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(name) === value) return;
  m.set(name, value);
  el.setAttribute(name, value);
}

function setStyle(el: SVGElement, prop: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  const key = `style:${prop}`;
  if (m.get(key) === value) return;
  m.set(key, value);
  el.style.setProperty(prop, value);
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, parent: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  parent.appendChild(node);
  return node;
}

function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Arc-length table. A closed stroke includes the segment back to its first point. */
export function arcOf(stroke: Stroke): { pts: Point[]; cum: Float64Array; len: number } {
  const src = stroke.pts;
  const first = src[0];
  const last = src[src.length - 1];
  const closed = !!stroke.closed && src.length > 2 && !!first && !!last && (first[0] !== last[0] || first[1] !== last[1]);
  const pts: Point[] = closed && first ? [...src, [first[0], first[1]]] : src.slice();
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum[i] = cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return { pts, cum, len: cum[pts.length - 1] ?? 0 };
}

/** First index i ≥ 1 with cum[i] ≥ dist (binary search). */
function segAt(cum: Float64Array, n: number, dist: number): number {
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < dist) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function pointAt(pts: Point[], cum: Float64Array, dist: number): { x: number; y: number } {
  const n = pts.length;
  const origin = pts[0] ?? [0, 0];
  if (n < 2 || dist <= 0) return { x: origin[0], y: origin[1] };
  const total = cum[n - 1]!;
  if (dist >= total) return { x: pts[n - 1]![0], y: pts[n - 1]![1] };
  const i = segAt(cum, n, dist);
  const a = pts[i - 1]!;
  const b = pts[i]!;
  const seg = cum[i]! - cum[i - 1]!;
  const k = seg > 0 ? (dist - cum[i - 1]!) / seg : 0;
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k };
}

/** Points of the visible prefix: every whole point below `dist`, plus the interpolated leading point. */
function slicePts(pts: Point[], cum: Float64Array, dist: number): Point[] {
  const n = pts.length;
  if (n === 0 || dist <= 0) return [];
  if (dist >= cum[n - 1]!) return pts;
  const i = segAt(cum, n, dist);
  const out = pts.slice(0, i);
  const tip = pointAt(pts, cum, dist);
  out.push([tip.x, tip.y]);
  return out;
}

/** Polyline `d` of the visible prefix. */
export function prefixD(pts: Point[], cum: Float64Array, dist: number): string {
  const vis = slicePts(pts, cum, dist);
  if (vis.length === 0) return '';
  const parts: string[] = ['M', num(vis[0]![0]), ' ', num(vis[0]![1])];
  for (let i = 1; i < vis.length; i++) parts.push('L', num(vis[i]![0]), ' ', num(vis[i]![1]));
  return parts.join('');
}

/** perfect-freehand outline → closed quadratic path (the library's recommended midpoint form). */
function pathFromOutline(outline: number[][]): string {
  const n = outline.length;
  if (n < 2) return '';
  const s0 = outline[0]!;
  const parts: string[] = ['M', num(s0[0]!), ' ', num(s0[1]!), 'Q'];
  for (let i = 0; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    parts.push(num(a[0]!), ' ', num(a[1]!), ' ', num((a[0]! + b[0]!) / 2), ' ', num((a[1]! + b[1]!) / 2), ' ');
  }
  parts.push('Z');
  return parts.join('');
}

const strokeOpts = (size: number): StrokeOptions => ({
  size,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.45,
  simulatePressure: true,
  easing: (v) => v,
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
  last: true,
});

function outlineD(pts: Point[], size: number): string {
  if (pts.length < 2) return '';
  return pathFromOutline(getStroke(pts.map((p) => [p[0], p[1]]), strokeOpts(size)));
}

/** Deterministic per-stroke offset from hash(overlayId, strokeIndex, boil bucket). */
function jitterOf(overlayId: string, index: number, bucket: number, amp: number): { x: number; y: number } {
  let n = Math.imul(bucket + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b);
  for (let i = 0; i < overlayId.length; i++) n = Math.imul(n ^ overlayId.charCodeAt(i), 0x01000193);
  n = n % 1_000_003;
  return { x: (hash(n) * 2 - 1) * amp, y: (hash(n + 97) * 2 - 1) * amp };
}

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m?.[1]) return `rgba(28,25,21,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function fit(box: [number, number], rect: TargetRect): TargetRect {
  const s = Math.min(rect.w / box[0], rect.h / box[1]);
  const w = box[0] * s;
  const h = box[1] * s;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

interface Geom {
  pts: Point[];
  cum: Float64Array;
  len: number;
  main: SVGPathElement;
  faint: SVGPathElement;
  mainD: string;
  faintD: string;
  /** Jitter bucket `faintD` was built for; −1 = not built. */
  bucket: number;
}

export function mountDraw(o: DrawSetup): DrawSession {
  const { doc, svg } = o;
  const line = doc.mode === 'line';
  if (line !== (o.approach === 'prefix' || o.approach === 'dash')) throw new Error(`${doc.mode} doc cannot use approach ${o.approach}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const boxMax = Math.max(doc.box[0], doc.box[1]);
  const color = o.color ?? '#1c1915';
  const penOn = o.pen ?? line;
  const fps = o.fps ?? 30;
  const amp = o.rough ?? boxMax * 0.012;
  const placed = fit(doc.box, o.rect);
  const arcs = doc.strokes.map(arcOf);
  const total = arcs.reduce((sum, a) => sum + a.len, 0);

  setAttr(svg, 'viewBox', `0 0 ${doc.box[0]} ${doc.box[1]}`);
  setAttr(svg, 'preserveAspectRatio', 'xMidYMid meet');
  const frameBox = (): void => {
    setStyle(svg, 'position', 'absolute');
    setStyle(svg, 'overflow', 'visible');
    setStyle(svg, 'left', `${placed.x.toFixed(2)}px`);
    setStyle(svg, 'top', `${placed.y.toFixed(2)}px`);
    setStyle(svg, 'width', `${placed.w.toFixed(2)}px`);
    setStyle(svg, 'height', `${placed.h.toFixed(2)}px`);
  };

  const pen = penOn ? svgEl('circle', svg) : null;
  const placePen = (tip: { x: number; y: number } | null): void => {
    if (!pen) return;
    setAttr(pen, 'r', num(Math.max(boxMax / 160, 2.5)));
    setAttr(pen, 'fill', color);
    setAttr(pen, 'cx', num(tip?.x ?? 0));
    setAttr(pen, 'cy', num(tip?.y ?? 0));
    setAttr(pen, 'visibility', tip ? 'visible' : 'hidden');
  };

  if (line) {
    const g = arcs[0]!;
    const path = svgEl('path', svg);
    if (pen) svg.appendChild(pen); // tip above the line
    const full = prefixD(g.pts, g.cum, g.len);
    const lenS = g.len.toFixed(3);
    const sw = num(o.width ?? Math.max(2, boxMax / 150));
    return {
      total,
      update(p: number): void {
        frameBox();
        const k = p < 0 ? 0 : p > 1 ? 1 : p;
        const dist = k * g.len;
        setAttr(path, 'fill', 'none');
        setAttr(path, 'stroke', color);
        setAttr(path, 'stroke-width', sw);
        setAttr(path, 'stroke-linecap', 'round');
        setAttr(path, 'stroke-linejoin', 'round');
        setAttr(path, 'visibility', k > 0 ? 'visible' : 'hidden');
        if (o.approach === 'dash') {
          setAttr(path, 'd', full);
          setAttr(path, 'stroke-dasharray', `${lenS} ${lenS}`);
          setAttr(path, 'stroke-dashoffset', (g.len - dist).toFixed(3));
        } else {
          setAttr(path, 'd', prefixD(g.pts, g.cum, dist));
        }
        placePen(k > 0 && k < 1 ? pointAt(g.pts, g.cum, dist) : null);
      },
    };
  }

  const size = o.width ?? boxMax / 90;
  const faintSize = size * 0.7;
  const faintFill = withAlpha(color, 0.35);
  const group = svgEl('g', svg);
  if (pen) svg.appendChild(pen);
  const geoms: Geom[] = arcs.map((a) => ({
    ...a,
    faint: svgEl('path', group),
    main: svgEl('path', group),
    mainD: '',
    faintD: '',
    bucket: -1,
  }));
  /** Faint pass of stroke `i`: the points offset by the stroke's jitter for `bucket`. */
  const faintOf = (i: number, bucket: number, pts: Point[]): string => {
    const j = jitterOf(o.overlayId, i, bucket, amp);
    return outlineD(pts.map((p) => [p[0] + j.x, p[1] + j.y]), faintSize);
  };
  // boil-shift: the jitter is a pure per-stroke offset, so the faint outline is built once, unshifted, and each
  // bucket only rewrites its `transform="translate(…)"` (an SVG attribute, not a composited CSS transform).
  const shiftMode = o.approach === 'boil-shift';
  if (o.approach !== 'recompute') {
    geoms.forEach((g, i) => {
      g.mainD = outlineD(g.pts, size);
      g.faintD = shiftMode ? outlineD(g.pts, faintSize) : faintOf(i, 0, g.pts);
      g.bucket = 0;
    });
  }

  return {
    total,
    update(p: number, t: number): void {
      frameBox();
      const k = p < 0 ? 0 : p > 1 ? 1 : p;
      const bucket = o.approach === 'boil' || shiftMode ? Math.max(0, Math.floor((t * fps) / 4)) : 0;
      let left = k * total;
      let tip: { x: number; y: number } | null = null;
      for (let i = 0; i < geoms.length; i++) {
        const g = geoms[i]!;
        setAttr(g.main, 'fill', color);
        setAttr(g.faint, 'fill', faintFill);
        if (shiftMode) {
          const j = jitterOf(o.overlayId, i, bucket, amp);
          setAttr(g.faint, 'transform', `translate(${num(j.x)} ${num(j.y)})`);
        }
        if (left <= 0 || g.len <= 0) {
          setAttr(g.main, 'd', '');
          setAttr(g.faint, 'd', '');
          continue;
        }
        if (left >= g.len) {
          if (o.approach === 'recompute') {
            setAttr(g.main, 'd', outlineD(g.pts, size));
            setAttr(g.faint, 'd', faintOf(i, bucket, g.pts));
          } else {
            if (!shiftMode && g.bucket !== bucket) {
              g.faintD = faintOf(i, bucket, g.pts);
              g.bucket = bucket;
            }
            setAttr(g.main, 'd', g.mainD);
            setAttr(g.faint, 'd', g.faintD);
          }
          left -= g.len;
          if (left <= 0) tip = pointAt(g.pts, g.cum, g.len);
          continue;
        }
        const partial = slicePts(g.pts, g.cum, left);
        setAttr(g.main, 'd', outlineD(partial, size));
        setAttr(g.faint, 'd', shiftMode ? outlineD(partial, faintSize) : faintOf(i, bucket, partial));
        tip = pointAt(g.pts, g.cum, left);
        left = 0;
      }
      placePen(k > 0 && k < 1 ? tip : null);
    },
  };
}
