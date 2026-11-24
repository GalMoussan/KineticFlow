/**
 * Planar 3D in the DOM (PLAN.md D16): parallel projections, plane → 2D channel maps, extrusion shadows and the
 * per-layer camera rig the spatial traits share. Page-side maths (trig): never run in the resolver.
 *
 * Conventions: world/object space has x right, y down and z away from the viewer (right-handed), in px of the layer.
 * A projection `Proj` is the linear part of a parallel projection, world (x, y, z) → layer (x, y). Under a parallel
 * projection any plane maps affinely, so a unit lying in a plane gets an exact 2D transform (`rot → skewX → scale`
 * from `affine()`); a plane facing a perspective camera only scales uniformly about the vanishing point.
 */
import { affine } from '@reel/runtime';
import type { Channels, Layer, Unit } from '../contract.ts';

export type Vec3 = [number, number, number];
/** 2D linear map in CSS `matrix(a, b, c, d)` order: (x, y) → (a·x + c·y, b·x + d·y). */
export type Mat2 = [number, number, number, number];
/** Rows of a 3D → 2D linear map: layer x = x·p, layer y = y·p. */
export interface Proj {
  x: Vec3;
  y: Vec3;
}
/** Rows of a 3D rotation. */
export type Mat3 = [Vec3, Vec3, Vec3];

const RAD = Math.PI / 180;

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const apply3 = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** Row-major product a·b. */
export function mul3(a: Mat3, b: Mat3): Mat3 {
  const c: Vec3[] = [0, 1, 2].map((j) => [b[0][j]!, b[1][j]!, b[2][j]!]);
  return a.map((r) => [dot(r, c[0]!), dot(r, c[1]!), dot(r, c[2]!)]) as Mat3;
}

/** Rotation by `deg` about the unit axis `n` (Rodrigues), right-handed. */
export function rotAxis(n: Vec3, deg: number): Mat3 {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const [x, y, z] = [n[0] / l, n[1] / l, n[2] / l];
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const k = 1 - c;
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}

/**
 * Camera rotation of an orbit: the world turned by `yaw` about the vertical axis (positive turns the object's right
 * side towards the viewer), then by `pitch` about the horizontal axis (positive: seen from above, top faces show),
 * then rolled by `roll` in the picture plane (degrees).
 */
export function orbit(yaw: number, pitch: number, roll = 0): Mat3 {
  const ry = rotAxis([0, 1, 0], yaw);
  const rx = rotAxis([1, 0, 0], pitch);
  const rz = rotAxis([0, 0, 1], roll);
  return mul3(rz, mul3(rx, ry));
}

/** Orthographic projection of a camera rotation (its first two rows). */
export const ortho = (r: Mat3): Proj => ({ x: r[0], y: r[1] });

/** Whether a face with world normal `n` faces the viewer under camera rotation `r` (its camera-space z < 0). */
export const facing = (r: Mat3, n: Vec3): number => -dot(r[2], n);

/** A world vector through a projection. */
export const project = (q: Proj, v: Vec3): [number, number] => [dot(q.x, v), dot(q.y, v)];

/**
 * A projection followed by a screen-space linear map K (still a parallel projection, possibly oblique). With
 * K = inverse of a plane's map at a rest pose, that plane is drawn undistorted at rest (cabinet-style front faces)
 * while every other face keeps the pose's depth cue.
 */
export const warp = (K: Mat2, q: Proj): Proj => ({
  x: [0, 1, 2].map((i) => K[0] * q.x[i]! + K[2] * q.y[i]!) as Vec3,
  y: [0, 1, 2].map((i) => K[1] * q.x[i]! + K[3] * q.y[i]!) as Vec3,
});

/** The 2D map of a plane spanned by world vectors e1, e2 (its local x and y axes) under projection q. */
export function planeMap(q: Proj, e1: Vec3, e2: Vec3): Mat2 {
  const [a, b] = project(q, e1);
  const [c, d] = project(q, e2);
  return [a, b, c, d];
}

export const mul2 = (p: Mat2, q: Mat2): Mat2 => [
  p[0] * q[0] + p[2] * q[1],
  p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3],
  p[1] * q[2] + p[3] * q[3],
];
export const det2 = (m: Mat2): number => m[0] * m[3] - m[1] * m[2];
export function inv2(m: Mat2): Mat2 {
  const d = det2(m);
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d];
}
export const apply2 = (m: Mat2, v: [number, number]): [number, number] => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];

/** The linear map a channel record commits: rotate(rot) · skewX(skx) · scale(sx, sy). */
export function chMat(rot: number, skx: number, sx: number, sy: number): Mat2 {
  const c = Math.cos(rot * RAD);
  const s = Math.sin(rot * RAD);
  const k = Math.tan(skx * RAD);
  // R · K = [c, s, c·k − s, s·k + c]; then · diag(sx, sy)
  return [c * sx, s * sx, (c * k - s) * sy, (s * k + c) * sy];
}

/** A unit's outer transform origin in its section group's coordinates (`unit.origin`: `%`/`px` pairs). */
export function originPx(u: Unit): [number, number] {
  const [ox = '50%', oy = '50%'] = u.origin.trim().split(/\s+/);
  const of = (v: string, size: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * size : parseFloat(v) || 0);
  return [u.box.x + of(ox, u.box.w), u.box.y + of(oy, u.box.h)];
}

/**
 * Whether a decomposed map is (nearly) edge-on: skew close to 90° or one axis collapsed. Such slivers carry no
 * content and their extreme transforms paint unstably, so `composeOuter` hides them.
 */
export const edgeOn = (a: { skx: number; sx: number; sy: number }): boolean => {
  const lo = Math.min(Math.abs(a.sx), Math.abs(a.sy));
  const hi = Math.max(Math.abs(a.sx), Math.abs(a.sy));
  return Math.abs(a.skx) > 80 || lo < 0.05 * hi || lo < 0.005;
};

/**
 * Whether text under this map should not be drawn: skewed past 20° or squashed below 0.55 of its other axis.
 * Chromium rasterises such glyphs differently depending on earlier frames and even between launches (measured
 * 3–13/255 in `dev/stills.ts` checks (b)/(c)); type that far turned away is unreadable anyway, so the spatial traits
 * hide it until it turns back.
 */
export const steep = (a: { skx: number; sx: number; sy: number }): boolean => {
  const lo = Math.min(Math.abs(a.sx), Math.abs(a.sy));
  const hi = Math.max(Math.abs(a.sx), Math.abs(a.sy));
  return Math.abs(a.skx) > 20 || lo < 0.55 * hi || edgeOn(a);
};

/**
 * Composes a 2D affine map x → o + t + L·(x − o) (about the unit's outer origin o) *before* whatever the outer
 * channels already hold, i.e. the existing transform applies on top in layer space. Writes tx/ty/rot/skx/sx/sy and
 * hides the unit when the result is edge-on (`edgeOn`).
 */
export function composeOuter(ch: Channels, t: [number, number], L: Mat2): void {
  const E = chMat(ch.rot, ch.skx, ch.sx, ch.sy);
  const M = mul2(E, L);
  const et = apply2(E, t);
  const a = affine(M[0], M[1], M[2], M[3]);
  ch.tx += et[0];
  ch.ty += et[1];
  ch.rot = a.rot;
  ch.skx = a.skx;
  ch.sx = a.sx;
  ch.sy = a.sy;
  ch.visible &&= !edgeOn(a);
}

/**
 * A plane in the world: group point g (section-group coordinates, px) lies at world `o + g.x·e1 + g.y·e2`. World
 * coordinates are relative to the pivot, which projects to layer point `v`.
 */
export interface Plane {
  o: Vec3;
  e1: Vec3;
  e2: Vec3;
}

/** Layer position of a world point through projection q, the pivot at layer point v. */
export function toLayer(q: Proj, p: Vec3, v: [number, number]): [number, number] {
  const [x, y] = project(q, p);
  return [v[0] + x, v[1] + y];
}

/**
 * The outer translation and linear map that put unit u (its box in group coordinates) onto `plane` under projection
 * q with the pivot at layer point v. For any group point g: layer = o + t + L·(g − o), o = the unit's origin.
 */
export function planeTransform(u: Unit, q: Proj, plane: Plane, v: [number, number]): { t: [number, number]; L: Mat2 } {
  const L = planeMap(q, plane.e1, plane.e2);
  const o = originPx(u);
  const world: Vec3 = add3(plane.o, add3(scale3(plane.e1, o[0]), scale3(plane.e2, o[1])));
  const [x, y] = toLayer(q, world, v);
  return { t: [x - o[0], y - o[1]], L };
}

/** Puts unit u onto `plane` (composing with its outer channels, see `composeOuter`). */
export function placeOnPlane(u: Unit, q: Proj, plane: Plane, v: [number, number]): void {
  const { t, L } = planeTransform(u, q, plane, v);
  composeOuter(u.ch, t, L);
}

/**
 * Extrusion as stacked `text-shadow` layers: the extruded depth projects to layer vector `d` (px); `total` is the
 * linear map from the shadowed element's own coordinates to the layer (outer · inner [· part]), so each offset is
 * `total⁻¹ · d · i/n` in the element's coordinates. `colors` runs front → back (one per layer, ≥ 1). A last soft
 * layer grounds the letters. Returns '' when the depth is negligible or the element is squashed below 0.4 of its
 * other axis (letters still standing up, the camera swung far round): there the stacked layers would be long smears
 * of thin glyphs, which Chromium rasterises history-dependently.
 */
export function extrusion(d: [number, number], total: Mat2, colors: readonly string[], soft: string | null, blur = 0): string {
  const len = Math.hypot(d[0], d[1]);
  const det = Math.abs(det2(total));
  if (len < 0.5 || det < 1e-3) return '';
  // singular values s1 ≥ s2 of `total`: s1² + s2² = ‖total‖², s1 · s2 = |det|
  const f2 = total[0] ** 2 + total[1] ** 2 + total[2] ** 2 + total[3] ** 2;
  const s1 = Math.sqrt((f2 + Math.sqrt(Math.max(0, f2 * f2 - 4 * det * det))) / 2);
  if (det / s1 < 0.4 * s1) return '';
  const inv = inv2(total);
  const [ox, oy] = apply2(inv, d);
  const n = colors.length;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    out.push(`${(ox * k).toFixed(2)}px ${(oy * k).toFixed(2)}px 0 ${colors[i - 1]}`);
  }
  if (soft) out.push(`${(ox * 1.15).toFixed(2)}px ${(oy * 1.15).toFixed(2)}px ${blur.toFixed(1)}px ${soft}`);
  return out.join(', ');
}

/**
 * A layer's 3D camera: one mutable record per layer whose capabilities the spatial traits fill in during
 * `layout`/`setup` (orbit: proj + origin; turntable: turn + radius; fly-through: dist + travel; an iso layout: proj +
 * origin built on the turntable's turn) and read in `frame`/`mount` (layout, reveal, material, background).
 * Every field is a pure function of t (or a constant) derived from params and timings.
 */
export interface Rig {
  /** Parallel projection at t (world → layer, linear part). */
  proj?(t: number): Proj;
  /** Layer point the world origin projects to at t. */
  origin?(t: number): [number, number];
  /** Turntable: degrees the world has turned about the vertical axis through (0, 0, radius) at t. */
  turn?(t: number): number;
  radius?: number;
  /** Perspective: distance from the camera to the layer's content plane at t, in focal lengths. */
  dist?(t: number): number;
  /** Perspective: forward travel since the reel began at t, in focal lengths, continuous across layers. */
  travel?(t: number): number;
  /** Perspective: camera roll at t (degrees), continuous across layers. */
  roll?(t: number): number;
  /** World y of a ground plane (backdrop floor grid), relative to the pivot. */
  floor?: number;
}

const rigs = new WeakMap<Layer, Rig>();
/** The layer's rig record (created empty on first use). */
export function rig(layer: Layer): Rig {
  let r = rigs.get(layer);
  if (!r) rigs.set(layer, (r = {}));
  return r;
}

/** Linear `#RRGGBB` mix (k = 0 → a). */
export function mix(a: string, b: string, k: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance of `#RRGGBB`. */
export function luminance(hex: string): number {
  const c = [0, 1, 2].map((i) => {
    const v = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG contrast ratio. */
export function contrastOf(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Of `options`, the colour with the best contrast against `bg`. */
export const readableOn = (bg: string, options: readonly string[]): string =>
  options.reduce((best, c) => (contrastOf(c, bg) > contrastOf(best, bg) ? c : best), options[0]!);
