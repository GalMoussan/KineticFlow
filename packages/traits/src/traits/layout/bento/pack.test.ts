import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mirror, packBento, type Cells, type TileScore } from './pack.ts';

/** Every cell covered exactly once. */
function covers(rects: Cells[], cols: number, rows: number): boolean {
  const seen = new Array(cols * rows).fill(0);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) seen[y * cols + x]++;
  return seen.every((v) => v === 1);
}

const area: TileScore = (w, h) => Math.log(w * h);

test('packBento: tiles fill the grid exactly, in reading order', () => {
  for (const [n, cols, rows] of [[1, 4, 6], [3, 4, 6], [5, 6, 9], [8, 6, 9], [7, 10, 6]] as const) {
    const rects = packBento(Array.from({ length: n }, () => area), cols, rows)!;
    assert.equal(rects.length, n);
    assert.ok(covers(rects, cols, rows), `${n} tiles cover ${cols}×${rows}`);
    // the first tile holds the top-left cell
    assert.deepEqual([rects[0]!.x, rects[0]!.y], [0, 0]);
  }
});

test('packBento: equal tiles share the area evenly; a heavier tile gets more', () => {
  const even = packBento([area, area], 4, 4)!;
  assert.deepEqual(even.map((r) => r.w * r.h), [8, 8]);
  const heavy: TileScore = (w, h) => 3 * Math.log(w * h);
  const uneven = packBento([heavy, area], 4, 4)!;
  assert.ok(uneven[0]!.w * uneven[0]!.h > uneven[1]!.w * uneven[1]!.h);
});

test('packBento: shapes follow the content (a wide tile gets a wide rect)', () => {
  // text 4 units wide per unit of height: font size = min(w / 4, h)
  const wide: TileScore = (w, h) => Math.log(Math.min(w / 4, h));
  const tall: TileScore = (w, h) => Math.log(Math.min(w, h / 4));
  const [a] = packBento([wide, area], 6, 6)!;
  assert.ok(a!.w > a!.h, `wide tile ${JSON.stringify(a)}`);
  const [, b] = packBento([area, tall], 6, 6)!;
  assert.ok(b!.h > b!.w, `tall tile ${JSON.stringify(b)}`);
});

test('packBento: infeasible scores and too many tiles give null; it is deterministic', () => {
  const never: TileScore = () => -Infinity;
  assert.equal(packBento([area, never], 4, 4), null);
  assert.equal(packBento(Array.from({ length: 5 }, () => area), 2, 2), null);
  const s = [area, (w: number, h: number) => 2 * Math.log(w * h), area, area];
  assert.deepEqual(packBento(s, 6, 9), packBento(s, 6, 9));
});

test('mirror: right-to-left packings flip x only', () => {
  const rects = packBento([area, area, area], 6, 4)!;
  const m = mirror(rects, 6);
  assert.ok(covers(m, 6, 4));
  assert.deepEqual(m.map((r) => [r.y, r.w, r.h]), rects.map((r) => [r.y, r.w, r.h]));
  assert.equal(m[0]!.x + m[0]!.w, 6);
});
