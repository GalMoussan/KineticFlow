/**
 * Where a sketch goes (SKETCH-PLAN.md P1): pure rectangle geometry, no DOM, so it is unit-tested in Node and the page
 * gets the same answer for the same layout.
 *
 * - `frame`: the drawing fitted into a rect given in fractions of the safe area (aspect kept, clamped by the safe
 *   height left below `y`), then rotated.
 * - `auto`: the largest drawing that fits into a free rectangle of the safe area: one that overlaps none of the
 *   obstacles (text boxes at the holds, inflated by a margin, and sketches already placed). Size is capped (`Cap`:
 *   presets stay doodle-sized, drawings may be larger). A free rectangle only counts when the drawing fitted into it
 *   is usable: its longer side reaches 18 % of the safe width. When no free rectangle is usable → a centred fallback
 *   under the text.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest usable drawing: its fitted longer side, as a share of the safe width. Below it a free rectangle is too small. */
export const MIN_FREE = 0.18;
/** Gap kept around text boxes, as a share of the frame's short side. */
export const TEXT_MARGIN = 0.025;
/** Scores within this relative tolerance count as equal (sub-pixel layout noise must not pick a cramped corner). */
const TIE = 0.03;

/** Largest size a drawing is fitted to, px. */
export interface Cap {
  w: number;
  h: number;
}

/** Size caps for auto placement: presets ≤ 45 % of the safe width, drawings ≤ 70 %; both ≤ half the safe height. */
export function autoCap(safe: Rect, preset: boolean): Cap {
  return { w: (preset ? 0.45 : 0.7) * safe.w, h: 0.5 * safe.h };
}

/** The drawing's box scaled into `r` (aspect kept, at most `cap`), centred. */
export function fitInto(box: readonly [number, number], r: Rect, cap: Cap = { w: Infinity, h: Infinity }): Rect {
  const s = Math.min(r.w / box[0], r.h / box[1], cap.w / box[0], cap.h / box[1]);
  const w = box[0] * s;
  const h = box[1] * s;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** `frame` placement: `x, y, w` are fractions of the safe area; the height is what the safe area has left below y. */
export function framePlacement(box: readonly [number, number], place: { x: number; y: number; w: number }, safe: Rect): Rect {
  const x = safe.x + place.x * safe.w;
  const y = safe.y + place.y * safe.h;
  const r = fitInto(box, { x, y, w: place.w * safe.w, h: Math.max(1, safe.y + safe.h - y) });
  return { ...r, y };
}

/** Axis-aligned box of `r` rotated by `deg` about its centre. */
export function rotatedBounds(r: Rect, deg: number): Rect {
  if (!deg) return r;
  const a = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const w = r.w * c + r.h * s;
  const h = r.w * s + r.h * c;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}

export interface AutoPlacement {
  /** Where the drawing goes. */
  rect: Rect;
  /** The free rectangle it was fitted into (the safe area itself on fallback). */
  free: Rect;
  fallback: boolean;
}

/**
 * Largest-drawing free rectangle. The plane is cut at every obstacle edge into a grid; for every pair of grid columns
 * the runs of rows that are free across all of them are candidate rectangles (every maximal free rectangle is one of
 * them). The winner maximises the fitted drawing's area (the drawing keeps its aspect, so a rectangle of the wrong
 * shape scores by what actually fits, capped by `cap`), then the free rectangle's own area, both within 3 %; then it
 * prefers the lower rectangle (under the text), then the left one. Candidates are visited in sorted grid order, so
 * the answer depends only on the geometry.
 */
export function autoPlacement(box: readonly [number, number], safe: Rect, obstacles: readonly Rect[], margin: number, cap: Cap): AutoPlacement {
  const x1 = safe.x + safe.w;
  const y1 = safe.y + safe.h;
  const obs = obstacles
    .map((o) => ({ x0: Math.max(safe.x, o.x - margin), y0: Math.max(safe.y, o.y - margin), x1: Math.min(x1, o.x + o.w + margin), y1: Math.min(y1, o.y + o.h + margin) }))
    .filter((o) => o.x1 > o.x0 && o.y1 > o.y0);
  const cuts = (lo: number, hi: number, vals: number[]) => [...new Set([lo, hi, ...vals])].sort((a, b) => a - b);
  const xs = cuts(safe.x, x1, obs.flatMap((o) => [o.x0, o.x1]));
  const ys = cuts(safe.y, y1, obs.flatMap((o) => [o.y0, o.y1]));
  const C = xs.length - 1;
  const R = ys.length - 1;
  // free[i][j]: grid cell (column i, row j) touches no obstacle
  const free = Array.from({ length: C }, (_, i) => {
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    return Array.from({ length: R }, (_, j) => {
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      return !obs.some((o) => cx > o.x0 && cx < o.x1 && cy > o.y0 && cy < o.y1);
    });
  });
  const minSide = MIN_FREE * safe.w;
  let best: { r: Rect; fit: number; area: number } | null = null;
  const better = (r: Rect, fit: number) => {
    if (!best) return true;
    const area = r.w * r.h;
    if (fit > best.fit * (1 + TIE) || fit < best.fit * (1 - TIE)) return fit > best.fit;
    if (area > best.area * (1 + TIE) || area < best.area * (1 - TIE)) return area > best.area;
    if (r.y + r.h !== best.r.y + best.r.h) return r.y + r.h > best.r.y + best.r.h;
    return r.x < best.r.x;
  };
  for (let i0 = 0; i0 < C; i0++) {
    const rows = free[i0]!.slice();
    for (let i1 = i0; i1 < C; i1++) {
      if (i1 > i0) for (let j = 0; j < R; j++) rows[j] = rows[j]! && free[i1]![j]!;
      for (let j = 0; j < R; ) {
        if (!rows[j]) {
          j++;
          continue;
        }
        let k = j;
        while (k + 1 < R && rows[k + 1]) k++;
        const r = { x: xs[i0]!, y: ys[j]!, w: xs[i1 + 1]! - xs[i0]!, h: ys[k + 1]! - ys[j]! };
        // usable at all? (judged on the fitted drawing, so wide drawings in short bands and tall ones in narrow
        // columns both count); only usable rectangles compete
        const f = fitInto(box, r, cap);
        const fit = f.w * f.h;
        if (Math.max(f.w, f.h) >= minSide && better(r, fit)) best = { r, fit, area: r.w * r.h };
        j = k + 1;
      }
    }
  }
  if (!best) {
    return { rect: fitInto(box, safe, cap), free: safe, fallback: true };
  }
  return { rect: fitInto(box, best.r, cap), free: best.r, fallback: false };
}

/** Area of `a ∩ b`. */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
