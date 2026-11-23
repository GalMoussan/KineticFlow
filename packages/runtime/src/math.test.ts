import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affine } from './math.ts';

/** Recomposes rotate → skewX → scale into the CSS matrix linear part [a, b, c, d]. */
function compose({ rot, skx, sx, sy }: { rot: number; skx: number; sx: number; sy: number }): number[] {
  const r = (rot * Math.PI) / 180;
  const t = Math.tan((skx * Math.PI) / 180);
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  return [cos * sx, sin * sx, (cos * t - sin) * sy, (sin * t + cos) * sy];
}

test('affine: rotate → skewX → scale reproduces any non-degenerate 2D linear map', () => {
  const iso = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), -Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  for (const m of [[1, 0, 0, 1], [2, 0, 0, 0.5], [0, 1, -1, 0], [0.8, 0.3, -0.2, 1.1], iso, [-1, 0, 0, 1], [0.5, -0.7, 0.9, 0.4]]) {
    const got = compose(affine(m[0]!, m[1]!, m[2]!, m[3]!));
    got.forEach((v, i) => assert.ok(Math.abs(v - m[i]!) < 1e-9, `${m} → ${got}`));
  }
});

test('affine: an edge-on map has zero area and is reported hidden', () => {
  assert.equal(affine(1, 0, 2, 0).sy, 0);
  assert.equal(affine(0, 0, 0, 1).sx, 0);
});
