/**
 * Seeded map geometry for `map-route` (page and unit test). No trigonometry and no `hash()` from the runtime:
 * street distances are Manhattan sums of absolute steps, and the walk is an integer hash, so Node and Chromium
 * agree. The route does not depend on any section's text, so a date-only edit cannot move the streets.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Street pitch, world px. Waypoints sit on intersections of this grid. */
export const STREET = 96;

/** Unsigned 32-bit mix. Deterministic in every JS engine that implements `Math.imul`. */
export function hsh(n: number): number {
  let x = Math.imul(n | 0, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * `n` intersections starting at the origin. Each step is `cells` street-pitches along one axis, so neighbours stay
 * at least `cells * STREET` apart (the layout picks `cells` from the frame so a hold shows one card).
 */
export function waypoints(n: number, cells: number, seed: number): Pt[] {
  const step = Math.max(1, cells) * STREET;
  const dirs: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let x = 0;
  let y = 0;
  let dir = hsh(seed) % 4;
  const pts: Pt[] = [{ x, y }];
  for (let i = 1; i < n; i++) {
    const turn = (hsh(seed + i * 97) % 3) - 1;
    dir = (dir + turn + 4) % 4;
    const d = dirs[dir]!;
    x += d[0] * step;
    y += d[1] * step;
    pts.push({ x, y });
  }
  return pts;
}

/** Axis-aligned polyline through `pts`, with one corner wherever a leg is diagonal. */
export function routeThrough(pts: readonly Pt[], seed = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = out[out.length - 1];
    if (q && q.x !== p.x && q.y !== p.y) {
      out.push(hsh(seed + i) % 2 === 0 ? { x: p.x, y: q.y } : { x: q.x, y: p.y });
    }
    if (!q || q.x !== p.x || q.y !== p.y) out.push({ x: p.x, y: p.y });
  }
  return out.length >= 2 ? out : [{ x: 0, y: 0 }, { x: STREET, y: 0 }];
}

/** Cumulative Manhattan length along an axis-aligned polyline. */
export function measure(pts: readonly Pt[]): { cum: number[]; length: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.abs(b.x - a.x) + Math.abs(b.y - a.y));
  }
  return { cum, length: cum[cum.length - 1] ?? 0 };
}

const ss = (k: number) => {
  const x = k < 0 ? 0 : k > 1 ? 1 : k;
  return x * x * (3 - 2 * x);
};

/**
 * Length of the route drawn at `t`. Reaches `pinAt` at `tPin` and `length` at `tEnd`. A pin at the end of the
 * route (`pinAt === length`, or `tPin >= tEnd`) is one smoothstep across the whole reel.
 */
export function routeDraw(length: number, pinAt: number, t: number, t0: number, tPin: number, tEnd: number): number {
  if (!(length > 0) || t <= t0) return 0;
  if (t >= tEnd) return length;
  const span = tEnd - t0;
  if (!(span > 0)) return length;
  if (!(pinAt < length) || !(tPin > t0) || !(tPin < tEnd)) return length * ss((t - t0) / span);
  if (t <= tPin) return pinAt * ss((t - t0) / (tPin - t0));
  return pinAt + (length - pinAt) * ss((t - tPin) / (tEnd - tPin));
}
