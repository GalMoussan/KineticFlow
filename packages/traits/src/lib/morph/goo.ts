/**
 * Gooey liquid drawn with SVG paths only (no filters): wobbling blobs and the metaball "neck" between two circles
 * (tangent points + cubic handles, after varun.ca/metaballs). Page-only (`Math.cos/sin/acos`).
 */
import type { Pt } from './geom.ts';

const f = (v: number) => (Math.round(v * 100) / 100).toString();
const at = (c: Pt, a: number, r: number): Pt => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
const P = (p: Pt) => `${f(p[0])},${f(p[1])}`;

/**
 * A wobbling blob around c: radius r, stretched by `sx`/`sy`, its edge rippling by `wob` (fraction of r) with phase
 * `ph`. Positive orientation (clockwise on screen), 40 points.
 */
export function blob(c: Pt, r: number, wob: number, ph: number, sx = 1, sy = 1): string {
  if (r <= 0.05) return '';
  let d = 'M';
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const k = 1 + wob * (0.6 * Math.sin(3 * a + ph) + 0.4 * Math.sin(5 * a - 1.3 * ph));
    d += (i ? 'L' : '') + f(c[0] + r * k * sx * Math.cos(a)) + ',' + f(c[1] + r * k * sy * Math.sin(a));
  }
  return d + 'Z';
}

/**
 * The neck joining circles (c1, r1) and (c2, r2) while they are closer than r1 + 2.5·r2; '' when apart or when one
 * contains the other. `v` is the neck spread (0.5 = soft), `handle` the curve tension.
 */
export function neck(c1: Pt, r1: number, c2: Pt, r2: number, v = 0.5, handle = 2.4): string {
  const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  if (r1 <= 0.5 || r2 <= 0.5 || d > r1 + 2.5 * r2 || d <= Math.abs(r1 - r2)) return '';
  const u1 = d < r1 + r2 ? Math.acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d)) : 0;
  const u2 = d < r1 + r2 ? Math.acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d)) : 0;
  const between = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  const spread = Math.acos((r1 - r2) / d);
  const a1 = between + u1 + (spread - u1) * v;
  const a2 = between - u1 - (spread - u1) * v;
  const a3 = between + Math.PI - u2 - (Math.PI - u2 - spread) * v;
  const a4 = between - Math.PI + u2 + (Math.PI - u2 - spread) * v;
  const p1 = at(c1, a1, r1);
  const p2 = at(c1, a2, r1);
  const p3 = at(c2, a3, r2);
  const p4 = at(c2, a4, r2);
  const k = Math.min(v * handle, Math.hypot(p1[0] - p3[0], p1[1] - p3[1]) / (r1 + r2)) * Math.min(1, (2 * d) / (r1 + r2));
  const h1 = at(p1, a1 - Math.PI / 2, r1 * k);
  const h2 = at(p2, a2 + Math.PI / 2, r1 * k);
  const h3 = at(p3, a3 + Math.PI / 2, r2 * k);
  const h4 = at(p4, a4 - Math.PI / 2, r2 * k);
  return `M${P(p1)}C${P(h1)} ${P(h3)} ${P(p3)}A${f(r2)},${f(r2)} 0 ${d > r1 ? 1 : 0} 0 ${P(p4)}C${P(h4)} ${P(h2)} ${P(p2)}Z`;
}
