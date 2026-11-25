import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUB_OF_BIG, subLanding, subScale, subUnits, wrapSub } from './subline.ts';

test('subScale is 38% of the largest big line and never above the smallest', () => {
  assert.equal(subScale([]), SUB_OF_BIG);
  assert.equal(subScale([0, -1]), SUB_OF_BIG);
  assert.equal(subScale([1]), 0.38);
  assert.equal(subScale([1, 0.5]), 0.38);
  assert.equal(subScale([0.78]), 0.38 * 0.78);
  assert.equal(subScale([0.24, 0.32]), 0.38 * 0.32);
  assert.equal(subScale([0.36, 0.22]), 0.38 * 0.36);
});

test('subUnits keeps only placed sub words, in order', () => {
  const units = [
    { item: 0, kind: 'word' },
    { item: 1, kind: 'sub' },
    { item: -1, kind: 'sub' },
    { item: 2, kind: 'sub' },
  ];
  assert.deepEqual(subUnits(units), [
    { item: 1, kind: 'sub' },
    { item: 2, kind: 'sub' },
  ]);
});

test('subLanding is a rising tick and silent before 0.6s', () => {
  assert.equal(subLanding(0.59, 0), null);
  const a = subLanding(0.7, 0);
  const b = subLanding(1.2, 4, -0.2);
  const c = subLanding(2, 20);
  assert.ok(a);
  assert.equal(a.kind, 'tick');
  assert.equal(a.weight, 0.18);
  assert.equal(a.pitch, 0);
  assert.equal(b?.weight, 0.3);
  assert.equal(b?.pitch, 8);
  assert.equal(b?.pan, -0.2);
  assert.ok(c);
  assert.ok(c.weight <= 0.35);
  assert.equal(c.pitch, 8);
});

test('wrapSub uses the fewest lines and balances them', () => {
  assert.deepEqual(wrapSub([], 1, 10), []);
  assert.deepEqual(wrapSub([3, 3, 3], 1, 20), [[0, 1, 2]]);
  // greedy at 10 would give [0,1] [2] … balanced keeps 2 lines but evens them
  assert.deepEqual(wrapSub([4, 4, 4, 4], 1, 14), [[0, 1], [2, 3]]);
  assert.deepEqual(wrapSub([2, 2, 2, 2, 2], 1, 9), [[0, 1, 2], [3, 4]]);
  // a word wider than the line sits alone
  assert.deepEqual(wrapSub([12, 2, 2], 1, 8), [[0], [1, 2]]);
});
