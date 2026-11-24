import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affine } from '@reel/runtime';
import type { Channels, Unit } from '../contract.ts';
import {
  apply2,
  apply3,
  chMat,
  composeOuter,
  det2,
  extrusion,
  facing,
  inv2,
  mul2,
  orbit,
  ortho,
  originPx,
  planeMap,
  planeTransform,
  project,
  rotAxis,
  warp,
  type Mat2,
  type Vec3,
} from './spatial.ts';

const close = (a: number, b: number, eps = 1e-9, what = '') => assert.ok(Math.abs(a - b) < eps, `${what} ${a} ≠ ${b}`);
const closeM = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((v, i) => close(v, b[i]!, eps, `[${i}]`));

const ch = (): Channels => ({
  tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, skx: 0, opacity: 1, blur: 0, itx: 0, ity: 0, isx: 1, isy: 1, irot: 0, iskx: 0,
  clip: 1, clipFrom: 'start', color: null, glow: 0, glowColor: null, split: 0, shadow: '', wght: 0, wdth: 0, visible: true,
});
const unit = (box: Unit['box'], origin: string): Unit => ({ box, origin, ch: ch() }) as unknown as Unit;

test('chMat inverts affine(): every 2D linear map round-trips through rot → skewX → scale', () => {
  const maps: Mat2[] = [
    [1, 0, 0, 1],
    [0.8, 0.3, -0.2, 0.9],
    [-0.5, 0.1, 0.4, 0.7], // mirrored (det < 0)
    [0.2, -0.9, 0.95, 0.15],
  ];
  for (const m of maps) {
    const a = affine(...m);
    closeM(chMat(a.rot, a.skx, a.sx, a.sy), m);
  }
});

test('orbit rotations are orthonormal; yaw shows the right face, pitch the top face', () => {
  const r = orbit(31, -17, 6);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(r[i]!.reduce((s, v, k) => s + v * r[j]![k]!, 0), i === j ? 1 : 0, 1e-12);
  assert.ok(facing(orbit(0, 0), [0, 0, -1]) > 0.999, 'front faces the viewer head-on');
  assert.ok(facing(orbit(30, 0), [1, 0, 0]) > 0.49, 'positive yaw turns the right face to the viewer');
  assert.ok(facing(orbit(-30, 0), [1, 0, 0]) < 0, 'negative yaw hides it');
  assert.ok(facing(orbit(0, 25), [0, -1, 0]) > 0.4, 'positive pitch shows the top face');
  // the front face of a yawed box foreshortens by cos(yaw); depth runs right for a positive yaw (we see its right side)
  const q = ortho(orbit(30, 0));
  closeM(planeMap(q, [1, 0, 0], [0, 1, 0]), [Math.cos(Math.PI / 6), 0, 0, 1], 1e-12);
  assert.ok(project(q, [0, 0, 1])[0] > 0.49);
});

test('rotAxis about an axis keeps the axis and turns a perpendicular vector by the angle', () => {
  const n: Vec3 = [0.2, 1, 0.1];
  const r = rotAxis(n, 70);
  const l = Math.hypot(...n);
  closeM(apply3(r, n), n, 1e-12);
  const p: Vec3 = [1, -0.2, 0];
  const rp = apply3(r, p);
  const cos = (p[0] * rp[0] + p[1] * rp[1] + p[2] * rp[2]) / (p[0] ** 2 + p[1] ** 2);
  close(cos, Math.cos((70 * Math.PI) / 180), 1e-12);
  assert.ok(l > 0);
});

test('planeTransform maps every point of a unit box to its projected world position', () => {
  const u = unit({ x: 100, y: 40, w: 300, h: 120 }, '25% 50%');
  closeM(originPx(u), [175, 100]);
  const q = ortho(orbit(28, 24));
  const plane = { o: [-540, -960, 30] as Vec3, e1: [1, 0, 0] as Vec3, e2: [0, 0.8, -0.6] as Vec3 };
  const v: [number, number] = [540, 960];
  const { t, L } = planeTransform(u, q, plane, v);
  const o = originPx(u);
  for (const g of [[100, 40], [400, 40], [100, 160], [400, 160], [250, 77]] as [number, number][]) {
    const viaUnit = apply2(L, [g[0] - o[0], g[1] - o[1]]).map((c, i) => c + o[i]! + t[i]!);
    const world: Vec3 = [0, 1, 2].map((k) => plane.o[k]! + g[0] * plane.e1[k]! + g[1] * plane.e2[k]!) as Vec3;
    const [x, y] = project(q, world);
    closeM(viaUnit, [v[0] + x, v[1] + y], 1e-9);
  }
});

test('composeOuter applies the plane first, then what the channels already held', () => {
  const c = ch();
  c.sx = c.sy = 1.2; // a kick scale written earlier
  c.tx = 5;
  const L: Mat2 = [0.9, 0.2, -0.1, 0.8];
  composeOuter(c, [10, -4], L);
  closeM(chMat(c.rot, c.skx, c.sx, c.sy), mul2([1.2, 0, 0, 1.2], L), 1e-9);
  close(c.tx, 5 + 12);
  close(c.ty, -4.8);
});

test('extrusion offsets land on the projected depth vector after the element transform', () => {
  const total = chMat(12, -8, 0.9, 1.1);
  const d: [number, number] = [14, 9];
  const s = extrusion(d, total, ['#111111', '#222222', '#333333', '#444444'], null);
  const layers = s.split(', ').map((l) => l.split(' ').slice(0, 2).map(parseFloat) as [number, number]);
  assert.equal(layers.length, 4);
  closeM(apply2(total, layers[3]!), d, 0.02);
  closeM(apply2(total, layers[1]!), [7, 4.5], 0.02);
  assert.equal(extrusion(d, [1, 0, 0, 1e-6], ['#000000'], null), '', 'edge-on: none');
  assert.equal(extrusion([0.1, 0.1], total, ['#000000'], null), '', 'negligible depth: none');
  assert.equal(extrusion(d, [1, 0, 0, 0.3], ['#000000'], null), '', 'squashed below 0.4: none');
  assert.notEqual(extrusion(d, [1, 0, 0, 0.5], ['#000000'], null), '', 'squashed to 0.5: drawn');
  closeM(mul2(total, inv2(total)), [1, 0, 0, 1], 1e-12);
  assert.ok(det2(total) > 0);
});

test('warp by the inverse rest map draws the front plane undistorted at rest and stays a parallel projection', () => {
  const q = ortho(orbit(26, 24));
  const K = inv2(planeMap(q, [1, 0, 0], [0, 1, 0]));
  const w = warp(K, q);
  closeM(planeMap(w, [1, 0, 0], [0, 1, 0]), [1, 0, 0, 1], 1e-12);
  // depth still recedes up and to the right (top and right faces show)
  const z = project(w, [0, 0, 1]);
  assert.ok(z[0] > 0 && z[1] < 0, `depth ${z}`);
  // linear in the world point: warp(K, q)(v) = K · q(v)
  const v: Vec3 = [3, -2, 5];
  closeM(project(w, v), apply2(K, project(q, v)), 1e-12);
});
