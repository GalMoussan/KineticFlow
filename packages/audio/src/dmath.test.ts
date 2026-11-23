import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as d from './dmath.ts';

/** Max |f − g| (or relative) over an even grid of `n + 1` points in [a, b]. */
function maxErr(f: (x: number) => number, g: (x: number) => number, a: number, b: number, rel = false, n = 100_000): number {
  let m = 0;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const y = f(x);
    const z = g(x);
    const e = rel ? Math.abs(y - z) / Math.max(Math.abs(z), 1e-300) : Math.abs(y - z);
    if (e > m) m = e;
  }
  return m;
}

// Bounds: measured max error vs the host Math (which is itself ≤ 1 ulp), with headroom of ~2×.
const cases: [string, number, number][] = [
  ['sin on [−2π, 2π] (abs)', maxErr(d.sin, Math.sin, -2 * Math.PI, 2 * Math.PI), 3e-16],
  ['sin on [−1e5, 1e5] (abs)', maxErr(d.sin, Math.sin, -1e5, 1e5), 3e-16],
  ['cos on [−2π, 2π] (abs)', maxErr(d.cos, Math.cos, -2 * Math.PI, 2 * Math.PI), 3e-16],
  ['tan on [−1.5, 1.5] (rel)', maxErr(d.tan, Math.tan, -1.5, 1.5, true), 5e-16],
  ['sinTurns on [−3, 3] (abs, vs Math.sin(2πp))', maxErr(d.sinTurns, (p) => Math.sin(2 * Math.PI * p), -3, 3), 5e-15],
  ['exp on [−745, 709] (rel)', maxErr(d.exp, Math.exp, -745, 709, true), 3e-16],
  ['exp on [−10, 10] (rel)', maxErr(d.exp, Math.exp, -10, 10, true), 3e-16],
  ['log on [1e-6, 1e6] (rel)', maxErr(d.log, Math.log, 1e-6, 1e6, true), 3e-16],
  ['log of 10^x, x ∈ [−300, 300] (rel)', maxErr((x) => d.log(10 ** x), (x) => Math.log(10 ** x), -300, 300, true), 3e-16],
  ['pow(2, y) on [−40, 40] (rel)', maxErr((y) => d.pow(2, y), (y) => 2 ** y, -40, 40, true), 5e-15],
  ['pow(x, 1.5) on [1e-6, 1] (rel)', maxErr((x) => d.pow(x, 1.5), (x) => x ** 1.5, 1e-6, 1, true), 3e-15],
  ['exp2 on [−40, 40] (rel)', maxErr(d.exp2, (y) => 2 ** y, -40, 40, true), 3e-16],
  ['mtof on [0, 127] (rel)', maxErr(d.mtof, (m) => 440 * 2 ** ((m - 69) / 12), 0, 127, true), 5e-16],
  ['tanh on [−30, 30] (abs)', maxErr(d.tanh, Math.tanh, -30, 30), 3e-16],
  ['dbToGain on [−120, 24] (rel)', maxErr(d.dbToGain, (x) => 10 ** (x / 20), -120, 24, true), 5e-15],
  ['gainToDb on [1e-6, 4] (abs)', maxErr(d.gainToDb, (g) => 20 * Math.log10(g), 1e-6, 4), 1e-13],
];

for (const [name, err, bound] of cases) {
  test(`dmath ${name}: max error ${err.toExponential(2)} ≤ ${bound}`, () => {
    assert.ok(err <= bound, `${err} > ${bound}`);
  });
}

test('dmath special values', () => {
  assert.equal(d.exp(0), 1);
  assert.equal(d.exp(-1000), 0);
  assert.equal(d.exp(1000), Infinity);
  assert.equal(d.log(1), 0);
  assert.equal(d.log(0), -Infinity);
  assert.ok(Number.isNaN(d.log(-1)));
  assert.equal(d.sin(0), 0);
  assert.equal(d.cos(0), 1);
  assert.equal(d.exp2(10), 1024);
  assert.equal(d.mtof(69), 440);
  assert.ok(Math.abs(d.pow(-2, 3) + 8) < 1e-14);
  assert.equal(d.tanh(100), 1);
  assert.ok(Math.abs(d.log(Number.MIN_VALUE) - Math.log(Number.MIN_VALUE)) < 1e-12);
});
