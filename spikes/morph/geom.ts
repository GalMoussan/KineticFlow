/**
 * Outline geometry + morph strategies. Pure, environment-agnostic (bundled into the browser page too).
 *  - flatten:   Cmd[] (M/L/Q/C/Z) → rings of points (px)
 *  - contours:  classify rings into outers/holes (orientation relative to the glyph's largest ring) + parent
 *  - ownMorph:  "area/centroid" strategy: Hungarian-matched outers↔outers and holes↔holes (holes only between
 *               matched parents), arc-length resampling, best cyclic offset, extras collapse/grow at a point that
 *               rides along an anchor contour (or, `split`, emerge from a copy of the anchor).
 *  - flubber*:  wrappers that use flubber's own APIs on the same rings.
 */
import type { Cmd } from './hb.ts';

export type Pt = [number, number];
export type Ring = Pt[];
export type Frame = (t: number) => string;

// ---------- flattening ----------

const SEG_PX = 2; // target chord length when flattening curves

export function flatten(cmds: Cmd[]): Ring[] {
  const rings: Ring[] = [];
  let cur: Ring = [];
  let px = 0;
  let py = 0;
  const close = () => {
    if (cur.length > 1) {
      const a = cur[0]!;
      const b = cur[cur.length - 1]!;
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) cur.pop();
    }
    if (cur.length >= 3) rings.push(cur);
    cur = [];
  };
  for (const { c, p } of cmds) {
    if (c === 'M') {
      close();
      px = p[0]!;
      py = p[1]!;
      cur.push([px, py]);
    } else if (c === 'L') {
      px = p[0]!;
      py = p[1]!;
      cur.push([px, py]);
    } else if (c === 'Q') {
      const [cx, cy, x, y] = p as [number, number, number, number];
      const n = Math.min(32, Math.max(2, Math.ceil((Math.hypot(cx - px, cy - py) + Math.hypot(x - cx, y - cy)) / SEG_PX)));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push([u * u * px + 2 * u * t * cx + t * t * x, u * u * py + 2 * u * t * cy + t * t * y]);
      }
      px = x;
      py = y;
    } else if (c === 'C') {
      const [c1x, c1y, c2x, c2y, x, y] = p as [number, number, number, number, number, number];
      const len = Math.hypot(c1x - px, c1y - py) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x - c2x, y - c2y);
      const n = Math.min(32, Math.max(2, Math.ceil(len / SEG_PX)));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push([
          u * u * u * px + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
          u * u * u * py + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        ]);
      }
      px = x;
      py = y;
    } else close();
  }
  close();
  return rings;
}

/** Parses any absolute M/L/Q/C/Z path (ours or flubber's "Mx,yLx,y…Z") into Cmds. */
export function parsePath(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MLQCZ])([^MLQCZ]*)/gi;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const body = (m[2] ?? '').trim();
    out.push({ c: m[1]!.toUpperCase() as Cmd['c'], p: body ? body.split(/[ ,]+/).map(Number) : [] });
  }
  return out;
}

// ---------- ring helpers ----------

export function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(r: Ring): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % n]!;
    const k = p[0] * q[1] - q[0] * p[1];
    a += k;
    cx += (p[0] + q[0]) * k;
    cy += (p[1] + q[1]) * k;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of r) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / r.length, sy / r.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function perimeter(r: Ring): number {
  let l = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % n]!;
    l += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return l;
}

export function pointInRing(pt: Pt, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** n points evenly spaced by arc length, starting at r[0]. */
export function resample(r: Ring, n: number): Ring {
  const per = perimeter(r);
  const step = per / n;
  const out: Ring = [];
  let i = 0;
  let acc = 0; // arc length at r[i]
  for (let k = 0; k < n; k++) {
    const target = k * step;
    for (;;) {
      const a = r[i % r.length]!;
      const b = r[(i + 1) % r.length]!;
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + seg >= target || i >= r.length - 1 + r.length) {
        const u = seg > 0 ? (target - acc) / seg : 0;
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
        break;
      }
      acc += seg;
      i++;
    }
  }
  return out;
}

/** Rotates b (cyclic) so it best matches a after removing both centroids (min sum of squared distances). */
export function align(a: Ring, b: Ring): Ring {
  const n = a.length;
  const ca = centroid(a);
  const cb = centroid(b);
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const bx = new Float64Array(n);
  const by = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ax[i] = a[i]![0] - ca[0];
    ay[i] = a[i]![1] - ca[1];
    bx[i] = b[i]![0] - cb[0];
    by[i] = b[i]![1] - cb[1];
  }
  let best = 0;
  let bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    let cost = 0;
    for (let i = 0; i < n && cost < bestCost; i++) {
      const j = (i + k) % n;
      const dx = ax[i]! - bx[j]!;
      const dy = ay[i]! - by[j]!;
      cost += dx * dx + dy * dy;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  return b.map((_, i) => b[(i + best) % n]!);
}

// ---------- contours ----------

export type Contour = { ring: Ring; area: number; c: Pt; per: number; outer: boolean; parent: number; holes: number[] };

/** Classifies rings of ONE glyph (orientation vs. its largest ring); concatenate results across glyphs. */
export function glyphContours(rings: Ring[]): Contour[] {
  if (!rings.length) return [];
  const areas = rings.map(signedArea);
  let big = 0;
  areas.forEach((a, i) => {
    if (Math.abs(a) > Math.abs(areas[big]!)) big = i;
  });
  const outerSign = Math.sign(areas[big]!);
  const cs: Contour[] = rings.map((r, i) => {
    const outer = Math.sign(areas[i]!) === outerSign;
    // Normalise orientation: outers positive (screen coords), holes negative → nonzero fill keeps holes.
    const ring = (areas[i]! > 0) === outer ? r : [...r].reverse();
    return { ring, area: Math.abs(areas[i]!), c: centroid(r), per: perimeter(r), outer, parent: -1, holes: [] };
  });
  return cs;
}

/** Links holes to the smallest outer containing them (indices are into the concatenated list). */
export function linkHoles(cs: Contour[]): Contour[] {
  cs.forEach((h, hi) => {
    if (h.outer) return;
    let best = -1;
    cs.forEach((o, oi) => {
      if (!o.outer || !pointInRing(h.ring[0]!, o.ring)) return;
      if (best < 0 || o.area < cs[best]!.area) best = oi;
    });
    if (best < 0) {
      // fallback: nearest outer centroid
      let bd = Infinity;
      cs.forEach((o, oi) => {
        const d = o.outer ? Math.hypot(o.c[0] - h.c[0], o.c[1] - h.c[1]) : Infinity;
        if (d < bd) {
          bd = d;
          best = oi;
        }
      });
    }
    h.parent = best;
    if (best >= 0) cs[best]!.holes.push(hi);
  });
  return cs;
}

/** Contours from clean polygons ([outer, ...holes], e.g. a boolean-union result); drops closing duplicates. */
export function contoursFromPolygons(polys: Ring[][]): Contour[] {
  const out: Contour[] = [];
  for (const poly of polys) {
    const oi = out.length;
    poly.forEach((raw, k) => {
      const r = raw.length > 1 && raw[0]![0] === raw[raw.length - 1]![0] && raw[0]![1] === raw[raw.length - 1]![1] ? raw.slice(0, -1) : raw;
      const outer = k === 0;
      const a = signedArea(r);
      const ring = (a > 0) === outer ? r : [...r].reverse();
      out.push({ ring, area: Math.abs(a), c: centroid(r), per: perimeter(r), outer, parent: outer ? -1 : oi, holes: [] });
      if (!outer) out[oi]!.holes.push(out.length - 1);
    });
  }
  return out;
}

export function circleRing(cx: number, cy: number, r: number, n = 128): Ring {
  // Positive signed area in screen coords (y down) = clockwise visually; start at the top.
  return Array.from({ length: n }, (_, i): Pt => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

export function rectRing(x: number, y: number, w: number, h: number): Ring {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function ringsToD(rings: Ring[]): string {
  let d = '';
  for (const r of rings) {
    d += 'M';
    for (let i = 0; i < r.length; i++) d += (i ? 'L' : '') + Math.round(r[i]![0] * 100) / 100 + ',' + Math.round(r[i]![1] * 100) / 100;
    d += 'Z';
  }
  return d;
}

// ---------- assignment (Hungarian, rectangular, deterministic) ----------

/** Returns assignment row→col (or -1) minimising total cost over min(n,m) pairs. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = n ? cost[0]!.length : 0;
  const N = Math.max(n, m);
  if (!N) return [];
  const C = (i: number, j: number) => (i < n && j < m ? cost[i]![j]! : 0);
  const u = new Float64Array(N + 1);
  const v = new Float64Array(N + 1);
  const p = new Int32Array(N + 1);
  const way = new Int32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(N + 1).fill(Infinity);
    const used = new Uint8Array(N + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= N; j++) {
        if (used[j]) continue;
        const cur = C(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= N; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const res = new Array<number>(n).fill(-1);
  for (let j = 1; j <= N; j++) if (p[j]! - 1 < n && j - 1 < m) res[p[j]! - 1] = j - 1;
  return res;
}

// ---------- own strategy ----------

/** `extraWindow`: fraction of the morph over which unmatched contours shrink (first part) / grow (last part). */
export type OwnOpts = { split?: boolean; spacing?: number; minPts?: number; extraWindow?: number };

type Track = {
  a: Float64Array; // interleaved x,y at t=0
  b: Float64Array; // interleaved x,y at t=1
  // extras: scale about a moving centre instead of plain lerp
  kind: 'pair' | 'shrink' | 'grow';
  c0: Pt; // own centroid (shrink: source centroid, grow: dest centroid)
  anchor: [Pt, Pt]; // anchor centroid at t=0 / t=1 (contour this extra rides along)
};

function bbox(cs: Contour[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cs)
    for (const p of c.ring) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
  return [x0, y0, x1, y1];
}

function norm(c: Pt, bb: [number, number, number, number]): Pt {
  const w = Math.max(bb[2] - bb[0], 1e-6);
  const h = Math.max(bb[3] - bb[1], 1e-6);
  return [(c[0] - bb[0]) / w, (c[1] - bb[1]) / h];
}

const flat = (r: Ring) => {
  const f = new Float64Array(r.length * 2);
  r.forEach((p, i) => {
    f[2 * i] = p[0];
    f[2 * i + 1] = p[1];
  });
  return f;
};

function pairTrack(ra: Ring, rb: Ring, spacing: number, minPts: number): Track {
  const n = Math.max(minPts, Math.ceil(Math.max(perimeter(ra), perimeter(rb)) / spacing));
  const a = resample(ra, n);
  const b = align(a, resample(rb, n));
  return { a: flat(a), b: flat(b), kind: 'pair', c0: [0, 0], anchor: [[0, 0], [0, 0]] };
}

export type MatchInfo = { pairs: [number, number][]; extrasA: number[]; extrasB: number[]; tracks: number; points: number };

/** Builds the own-strategy morph between two contour sets. */
export function ownMorph(A: Contour[], B: Contour[], opts: OwnOpts = {}): { frame: Frame; info: MatchInfo; dA: string; dB: string } {
  const spacing = opts.spacing ?? 2;
  const minPts = opts.minPts ?? 24;
  const W = opts.extraWindow ?? 0.6;
  const bbA = bbox(A);
  const bbB = bbox(B);
  const cost = (ia: number, ib: number) => {
    const a = A[ia]!;
    const b = B[ib]!;
    const na = norm(a.c, bbA);
    const nb = norm(b.c, bbB);
    const la = Math.log(a.area / Math.max(b.area, 1e-6));
    return (na[0] - nb[0]) ** 2 + (na[1] - nb[1]) ** 2 + 0.05 * la * la;
  };
  const oa = A.map((c, i) => (c.outer ? i : -1)).filter((i) => i >= 0);
  const ob = B.map((c, i) => (c.outer ? i : -1)).filter((i) => i >= 0);
  const pairOf = new Map<number, number>(); // A index → B index
  hungarian(oa.map((ia) => ob.map((ib) => cost(ia, ib)))).forEach((j, i) => {
    if (j >= 0) pairOf.set(oa[i]!, ob[j]!);
  });
  // holes: only between holes whose parents are paired; cost relative to the parent centroid
  const ha = A.map((c, i) => (!c.outer ? i : -1)).filter((i) => i >= 0);
  const hb = B.map((c, i) => (!c.outer ? i : -1)).filter((i) => i >= 0);
  const BIG = 1e6;
  const holeCost = ha.map((ia) =>
    hb.map((ib) => {
      const a = A[ia]!;
      const b = B[ib]!;
      if (a.parent < 0 || b.parent < 0 || pairOf.get(a.parent) !== b.parent) return BIG;
      const pa = A[a.parent]!;
      const pb = B[b.parent]!;
      const ra: Pt = [(a.c[0] - pa.c[0]) / Math.sqrt(pa.area), (a.c[1] - pa.c[1]) / Math.sqrt(pa.area)];
      const rb: Pt = [(b.c[0] - pb.c[0]) / Math.sqrt(pb.area), (b.c[1] - pb.c[1]) / Math.sqrt(pb.area)];
      const la = Math.log(a.area / Math.max(b.area, 1e-6));
      return (ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + 0.05 * la * la;
    }),
  );
  hungarian(holeCost).forEach((j, i) => {
    if (j >= 0 && holeCost[i]![j]! < BIG) pairOf.set(ha[i]!, hb[j]!);
  });
  const pairs = [...pairOf.entries()].sort((x, y) => x[0] - y[0]);
  const matchedA = new Set(pairOf.keys());
  const matchedB = new Set(pairOf.values());
  const inv = new Map(pairs.map(([a, b]) => [b, a]));
  const extrasA = A.map((_, i) => i).filter((i) => !matchedA.has(i));
  const extrasB = B.map((_, i) => i).filter((i) => !matchedB.has(i));

  const tracks: Track[] = pairs.map(([ia, ib]) => pairTrack(A[ia]!.ring, B[ib]!.ring, spacing, minPts));

  // Anchor for an extra: its parent if paired, else the nearest paired outer in the same shape.
  const anchorFor = (cs: Contour[], i: number, paired: Map<number, number>, other: Contour[]): [Pt, Pt] | null => {
    const c = cs[i]!;
    let k = -1;
    if (!c.outer && c.parent >= 0 && paired.has(c.parent)) k = c.parent;
    else {
      const from = !c.outer && c.parent >= 0 ? cs[c.parent]!.c : c.c;
      let bd = Infinity;
      for (const [j] of paired) {
        if (!cs[j]!.outer) continue;
        const d = Math.hypot(cs[j]!.c[0] - from[0], cs[j]!.c[1] - from[1]);
        if (d < bd) {
          bd = d;
          k = j;
        }
      }
    }
    if (k < 0) return null;
    return [cs[k]!.c, other[paired.get(k)!]!.c];
  };
  const nearestPairedOuter = (cs: Contour[], i: number, paired: Map<number, number>): number => {
    let k = -1;
    let bd = Infinity;
    for (const [j] of paired) {
      if (!cs[j]!.outer) continue;
      const d = Math.hypot(cs[j]!.c[0] - cs[i]!.c[0], cs[j]!.c[1] - cs[i]!.c[1]);
      if (d < bd) {
        bd = d;
        k = j;
      }
    }
    return k;
  };

  for (const ia of extrasA) {
    const c = A[ia]!;
    if (opts.split && c.outer && !c.holes.length) {
      const k = nearestPairedOuter(A, ia, pairOf);
      if (k >= 0 && !B[pairOf.get(k)!]!.holes.length) {
        tracks.push(pairTrack(c.ring, B[pairOf.get(k)!]!.ring, spacing, minPts));
        continue;
      }
    }
    const an = anchorFor(A, ia, pairOf, B) ?? [c.c, c.c];
    const f = flat(c.ring);
    // a hole whose parent is also an extra scales about the parent's centre so it stays inside it
    const c0 = !c.outer && c.parent >= 0 && !pairOf.has(c.parent) ? A[c.parent]!.c : c.c;
    tracks.push({ a: f, b: f, kind: 'shrink', c0, anchor: an });
  }
  for (const ib of extrasB) {
    const c = B[ib]!;
    if (opts.split && c.outer && !c.holes.length) {
      const k = nearestPairedOuter(B, ib, inv);
      if (k >= 0 && !A[inv.get(k)!]!.holes.length) {
        tracks.push(pairTrack(A[inv.get(k)!]!.ring, c.ring, spacing, minPts));
        continue;
      }
    }
    const an = anchorFor(B, ib, inv, A);
    const f = flat(c.ring);
    const c0 = !c.outer && c.parent >= 0 && !inv.has(c.parent) ? B[c.parent]!.c : c.c;
    tracks.push({ a: f, b: f, kind: 'grow', c0, anchor: an ? [an[1], an[0]] : [c.c, c.c] });
  }
  const dA = ringsToD(A.map((c) => c.ring));
  const dB = ringsToD(B.map((c) => c.ring));
  const points = tracks.reduce((s, tr) => s + tr.a.length / 2, 0);

  const frame: Frame = (t) => {
    if (t <= 0) return dA;
    if (t >= 1) return dB;
    let d = '';
    for (const tr of tracks) {
      const { a, b } = tr;
      if (tr.kind === 'pair') {
        d += 'M';
        for (let i = 0; i < a.length; i += 2) {
          const x = a[i]! + (b[i]! - a[i]!) * t;
          const y = a[i + 1]! + (b[i + 1]! - a[i + 1]!) * t;
          d += (i ? 'L' : '') + Math.round(x * 100) / 100 + ',' + Math.round(y * 100) / 100;
        }
      } else {
        // scale s about own centre; centre rides along the anchor's displacement; s = 0 → omitted
        const s = tr.kind === 'shrink' ? Math.max(0, 1 - t / W) : Math.max(0, (t - (1 - W)) / W);
        if (s === 0) continue;
        const an = tr.anchor;
        const ref = tr.kind === 'shrink' ? an[0] : an[1];
        const ax = an[0][0] + (an[1][0] - an[0][0]) * t - ref[0];
        const ay = an[0][1] + (an[1][1] - an[0][1]) * t - ref[1];
        const cx = tr.c0[0] + ax;
        const cy = tr.c0[1] + ay;
        d += 'M';
        for (let i = 0; i < a.length; i += 2) {
          const x = cx + (a[i]! - tr.c0[0]) * s;
          const y = cy + (a[i + 1]! - tr.c0[1]) * s;
          d += (i ? 'L' : '') + Math.round(x * 100) / 100 + ',' + Math.round(y * 100) / 100;
        }
      }
      d += 'Z';
    }
    return d;
  };
  return { frame, info: { pairs, extrasA, extrasB, tracks: tracks.length, points }, dA, dB };
}

// ---------- quality metrics ----------

function segX(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Number of proper self-crossings within each ring, summed (twisting indicator). */
export function selfIntersections(rings: Ring[]): number {
  let total = 0;
  for (const r of rings) {
    const n = r.length;
    if (n < 4) continue;
    for (let i = 0; i < n; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % n]!;
      const minx = Math.min(a[0], b[0]);
      const maxx = Math.max(a[0], b[0]);
      const miny = Math.min(a[1], b[1]);
      const maxy = Math.max(a[1], b[1]);
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = r[j]!;
        const e = r[(j + 1) % n]!;
        if (Math.max(c[0], e[0]) < minx || Math.min(c[0], e[0]) > maxx || Math.max(c[1], e[1]) < miny || Math.min(c[1], e[1]) > maxy) continue;
        if (segX(a[0], a[1], b[0], b[1], c[0], c[1], e[0], e[1])) total++;
      }
    }
  }
  return total;
}

/** Rings from any frame path (flattens curves at the exact endpoints). */
export function frameRings(d: string): Ring[] {
  return flatten(parsePath(d));
}
