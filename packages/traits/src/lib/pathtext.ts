/**
 * Text on paths (ribbon-path, orbit-ring): measured grapheme parts are moved with translate + rotate only (uniform,
 * glyph-history safe, README §1) so that a point of each glyph rides a path, and they return to their measured place
 * (tx = ty = rot = 0) at the hold, where QA reads the unit's ink box. Glyph positions come from the host's measured
 * split (PLAN.md §5.4: measured advances, never SVG `textPath`). Page-side helpers (trigonometry is fine here: no
 * Node code path uses them except the unit test).
 */
import type { Part, Unit } from '../contract.ts';

export interface Pt {
  x: number;
  y: number;
}

/** A point on a path with its tangent angle (radians, screen coordinates: y down, so positive = clockwise). */
export interface PathPt extends Pt {
  a: number;
}

/** A part's measured centre in its section group's coordinates (untransformed unit). */
export function partCentre(u: Unit, p: Part): Pt {
  return { x: u.box.x + u.textAt.x + p.x + p.w / 2, y: u.box.y + u.textAt.y + p.y + p.h / 2 };
}

/**
 * Adds to `ch` (a part's or a unit's channels) the translate + rotate that put the element's anchor on `at` turned
 * by `at.a`; the element rotates about its centre `home` (group px at rest), and its anchor is the point `off` px
 * below that centre (positive `off` = the centre sits above the anchor, e.g. a baseline anchor). At
 * `at` = (home.x, home.y + off, a = 0) nothing moves.
 */
export function ride(ch: { tx: number; ty: number; rot: number }, home: Pt, off: number, at: PathPt): void {
  const s = Math.sin(at.a);
  const c = Math.cos(at.a);
  // the centre is the anchor plus the rotated vector (0, −off)
  ch.tx += at.x + off * s - home.x;
  ch.ty += at.y - off * c - home.y;
  ch.rot += (at.a * 180) / Math.PI;
}

/** Polyline of a cubic Bézier (n segments, both ends included). */
export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return out;
}

/**
 * Arc-length parametrised polyline. `at(s)` interpolates linearly between samples; outside [0, length] it extends
 * the first/last segment along its tangent, so glyphs can start before the path and leave after it.
 */
export class Polyline {
  readonly pts: Pt[];
  /** Cumulative length at each point. */
  readonly cum: number[];
  readonly length: number;

  constructor(points: readonly Pt[]) {
    const pts: Pt[] = [];
    for (const p of points) {
      const q = pts.at(-1);
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) pts.push({ x: p.x, y: p.y });
    }
    if (pts.length < 2) throw new Error('Polyline needs two distinct points');
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    this.pts = pts;
    this.cum = cum;
    this.length = cum.at(-1)!;
  }

  at(s: number): PathPt {
    const { pts, cum } = this;
    const n = pts.length;
    let i: number;
    if (s <= 0) i = 0;
    else if (s >= this.length) i = n - 2;
    else {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid]! <= s) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const L = cum[i + 1]! - cum[i]!;
    const k = (s - cum[i]!) / L;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** Arc length of the sample nearest to `p` (projection onto the closest segment). */
  project(p: Pt): number {
    let best = Infinity;
    let at = 0;
    for (let i = 0; i + 1 < this.pts.length; i++) {
      const a = this.pts[i]!;
      const b = this.pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
      const d = Math.hypot(a.x + dx * k - p.x, a.y + dy * k - p.y);
      if (d < best) {
        best = d;
        at = this.cum[i]! + Math.sqrt(L2) * k;
      }
    }
    return at;
  }

  /** SVG path data of the samples. */
  d(): string {
    return this.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }
}
