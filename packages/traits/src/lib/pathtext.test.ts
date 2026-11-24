import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Polyline, cubic, ride } from './pathtext.ts';

test('ride is the identity when the anchor is already home', () => {
  const ch = { tx: 0, ty: 0, rot: 0 };
  ride(ch, { x: 10, y: 20 }, 4, { x: 10, y: 24, a: 0 });
  assert.equal(ch.tx, 0);
  assert.equal(ch.ty, 0);
  assert.equal(ch.rot, 0);
});

test('a straight polyline reports arc length and extends along its tangent', () => {
  const line = new Polyline([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  assert.equal(line.length, 100);
  const mid = line.at(40);
  assert.equal(mid.x, 40);
  assert.equal(mid.y, 0);
  assert.equal(mid.a, 0);
  const before = line.at(-10);
  assert.equal(before.x, -10);
  assert.equal(before.y, 0);
  assert.ok(Math.abs(line.project({ x: 25, y: 3 }) - 25) < 1e-6);
});

test('cubic samples include both ends', () => {
  const pts = cubic({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, 8);
  assert.equal(pts.length, 9);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts.at(-1), { x: 10, y: 0 });
});
