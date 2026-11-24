import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositions, fitSize, solveGrid, type GridItem, type GridSpec } from './solve.ts';

const G: GridSpec = { cols: 4, rows: 6, cw: 200, rh: 200, g: 20, pad: 10 };
const word = (w1: number, weight = 1): GridItem => ({ w1, h1: 0.9, weight, top: 0 });

test('compositions: every ordered split, lexicographic', () => {
  assert.deepEqual(compositions(4, 2), [[1, 3], [2, 2], [3, 1]]);
  assert.equal(compositions(6, 3).length, 10);
  assert.deepEqual(compositions(2, 3), []);
});

test('solveGrid: lines use every column, keep order and fit the rows', () => {
  const items = [word(3), word(2), word(5, 2), word(1, 0.5), word(4)];
  const lines = solveGrid(items, G, 3)!;
  assert.ok(lines);
  assert.equal(lines[0]!.from, 0);
  assert.equal(lines.at(-1)!.to, items.length - 1);
  lines.forEach((l, i) => {
    if (i) assert.equal(l.from, lines[i - 1]!.to + 1);
    assert.equal(l.cols.length, l.to - l.from + 1);
    assert.equal(l.cols.reduce((a, b) => a + b, 0), G.cols);
    assert.ok(l.to - l.from + 1 <= 3);
  });
  assert.ok(lines.reduce((a, l) => a + l.rows, 0) <= G.rows);
});

test('solveGrid: a heavier unit gets a bigger span; one unit takes the full width and only the rows it needs', () => {
  const [l] = solveGrid([word(3)], G, 3)!;
  // width-bound at any height ≥ 2 rows: the first (smallest) row count that reaches the size wins
  assert.deepEqual([l!.rows, l!.cols], [2, [G.cols]]);
  const lines = solveGrid([word(3, 3), word(3, 1)], { ...G, rows: 2 }, 2)!;
  if (lines.length === 1) assert.ok(lines[0]!.cols[0]! > lines[0]!.cols[1]!);
  else assert.ok(fitSize(word(3), G.cols, lines[0]!.rows, G) >= fitSize(word(3), G.cols, lines[1]!.rows, G));
});

test('solveGrid: too many units for the rows → null; deterministic', () => {
  assert.equal(solveGrid(Array.from({ length: 7 }, () => word(2)), { ...G, rows: 2 }, 3), null);
  const items = [word(2), word(4, 1.6), word(1, 0.5)];
  assert.deepEqual(solveGrid(items, G, 3), solveGrid(items, G, 3));
});
