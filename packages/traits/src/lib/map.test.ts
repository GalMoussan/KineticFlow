import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STREET, hsh, measure, routeDraw, routeThrough, waypoints } from './map.ts';

test('waypoints sit on the street grid and stay a full step apart', () => {
  const cells = 17;
  const pts = waypoints(8, cells, 42);
  assert.equal(pts.length, 8);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    assert.equal(dx === 0 || dy === 0, true);
    assert.equal(dx + dy, cells * STREET);
    assert.ok(b.x % STREET === 0, `x ${b.x} is off the street grid`);
    assert.ok(b.y % STREET === 0, `y ${b.y} is off the street grid`);
  }
});

test('the same seed walks the same streets', () => {
  assert.deepEqual(waypoints(6, 12, 7), waypoints(6, 12, 7));
  assert.notDeepEqual(waypoints(6, 12, 7), waypoints(6, 12, 8));
});

test('routeThrough stays axis-aligned and measure matches the Manhattan length', () => {
  const route = routeThrough([
    { x: 0, y: 0 },
    { x: 100, y: 40 },
    { x: 100, y: 40 },
  ]);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    assert.equal(a.x === b.x || a.y === b.y, true);
  }
  const m = measure(route);
  assert.equal(m.length, 140);
  assert.equal(m.cum.at(-1), 140);
  assert.equal(routeThrough(waypoints(5, 10, 3), 3).length >= 5, true);
});

test('routeDraw hits the pin on time and the end on time, and is still before it starts', () => {
  assert.equal(routeDraw(1000, 400, 0, 1, 5, 9), 0);
  assert.equal(routeDraw(1000, 400, 5, 1, 5, 9), 400);
  assert.equal(routeDraw(1000, 400, 9, 1, 5, 9), 1000);
  assert.equal(routeDraw(1000, 1000, 4, 1, 8, 8), 1000 * ((3 / 7) ** 2 * (3 - 2 * (3 / 7))));
  assert.ok(routeDraw(1000, 400, 3, 1, 5, 9) > 0);
  assert.ok(routeDraw(1000, 400, 3, 1, 5, 9) < 400);
  assert.equal(hsh(1) >>> 0, hsh(1));
});
