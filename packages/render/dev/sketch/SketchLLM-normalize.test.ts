/**
 * P0 spike S1. Run: node --test packages/render/dev/sketch/SketchLLM-normalize.test.ts
 * (Node ≥ 22; this repo's engine is Node ≥ 26.)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { problems, type SketchDoc, type Stroke } from './doc.ts';
import { joinNearest, joinToSingleLine, normalize } from './SketchLLM-normalize.ts';

const meta: SketchDoc['meta'] = { source: 'llm', detail: 3, seed: 1, version: 'test' };

function doc(strokes: Stroke[], mode: 'sketch' | 'line' = 'sketch', box: [number, number] = [1000, 1000]): SketchDoc {
  return { v: 1, box, mode, strokes, meta };
}

test('a right-angle corner is kept, then the drawing fits in the margin as integers', () => {
  const out = normalize(doc([{ pts: [[0, 0], [0, 920], [920, 920]] }]));
  assert.deepEqual(out.strokes[0]!.pts, [
    [40, 40],
    [40, 960],
    [960, 960],
  ]);
  assert.deepEqual(problems(out), []);
});

test('a gentle turn is cut by at most 20 units on each side', () => {
  const out = normalize(doc([{ pts: [[0, 0], [400, 0], [800, 200]] }]));
  assert.deepEqual(out.strokes[0]!.pts, [
    [40, 385],
    [477, 385],
    [521, 395],
    [960, 615],
  ]);
});

test('a gentle turn after a short segment is cut at a quarter of it', () => {
  const out = normalize(doc([{ pts: [[0, 0], [0, 40], [920, 920]] }]));
  assert.deepEqual(out.strokes[0]!.pts, [
    [40, 40],
    [40, 70],
    [54, 94],
    [960, 960],
  ]);
});

test('a square loop keeps its corners; an octagon is smoothed across its seam and stays closed', () => {
  const square = normalize(doc([{ pts: [[0, 0], [920, 0], [920, 920], [0, 920], [0, 0]] }]));
  assert.deepEqual(square.strokes[0]!.pts, [
    [40, 40],
    [960, 40],
    [960, 960],
    [40, 960],
    [40, 40],
  ]);
  const octagon: [number, number][] = [[300, 0], [600, 0], [900, 300], [900, 600], [600, 900], [300, 900], [0, 600], [0, 300], [300, 0]];
  const pts = normalize(doc([{ pts: octagon }])).strokes[0]!.pts;
  assert.equal(pts.length, 17);
  assert.deepEqual(pts[0], [332, 54]);
  assert.deepEqual(pts[0], pts.at(-1));
  assert.ok(!pts.some((p) => p[0] === 347 && p[1] === 40), 'the seam corner is cut');
});

test('join enters a loop at the vertex nearest the pen and walks it once around', () => {
  const out = joinToSingleLine(
    doc(
      [
        { pts: [[0, 0], [100, 0]] },
        { pts: [[300, 0], [300, 300], [110, 300], [110, 0], [300, 0]] },
      ],
      'line',
    ),
  );
  assert.deepEqual(out.strokes[0]!.pts, [
    [0, 0],
    [100, 0],
    [110, 0],
    [300, 0],
    [300, 300],
    [110, 300],
    [110, 0],
  ]);
});

test('join closes a stroke flagged closed', () => {
  const out = joinToSingleLine(doc([{ pts: [[0, 0], [10, 0], [10, 10]], closed: true }], 'line'));
  assert.deepEqual(out.strokes[0]!.pts, [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 0],
  ]);
});

test('a two-point stroke is not smoothed and a horizontal line is centered', () => {
  const out = normalize(doc([{ pts: [[0, 0], [920, 0]] }]));
  assert.deepEqual(out.strokes[0]!.pts, [
    [40, 500],
    [960, 500],
  ]);
});

test('fit maps an out-of-range box into the canvas with the margin', () => {
  const out = normalize(doc([{ pts: [[-460, -460], [460, 460]] }]));
  assert.deepEqual(out.strokes[0]!.pts, [
    [40, 40],
    [960, 960],
  ]);
  assert.deepEqual(problems(out), []);
});

test('drops degenerate strokes and points outside the sane range', () => {
  const out = normalize(
    doc([
      { pts: [[0, 0]] },
      { pts: [[5, 5], [5, 5]] },
      { pts: [[0, 0], [100_000, 0]] },
      { pts: [[0, 0], [920, 0]] },
    ]),
  );
  assert.equal(out.strokes.length, 1);
  assert.deepEqual(out.strokes[0]!.pts, [
    [40, 500],
    [960, 500],
  ]);
  assert.deepEqual(problems(out), []);
});

test('an empty or fully degenerate doc stays empty', () => {
  assert.deepEqual(problems(normalize(doc([]))), ['no strokes']);
  assert.deepEqual(problems(normalize(doc([{ pts: [[1, 1], [1, 1]] }]))), ['no strokes']);
});

test('sketch strokes are capped at 80 points and line strokes are not', () => {
  const pts = Array.from({ length: 100 }, (_, i) => {
    const t = i / 99;
    return [t * 920, t * 460] as [number, number];
  });
  const sketch = normalize(doc([{ pts }]));
  assert.equal(sketch.strokes[0]!.pts.length, 80);
  assert.deepEqual(sketch.strokes[0]!.pts[0], [40, 270]);
  assert.deepEqual(sketch.strokes[0]!.pts.at(-1), [960, 730]);
  assert.deepEqual(problems(sketch), []);

  const line = normalize(doc([{ pts: Array.from({ length: 100 }, (_, i) => [i * (920 / 99), 0] as [number, number]) }], 'line'));
  assert.ok(line.strokes[0]!.pts.length > 80);
  assert.ok(line.strokes[0]!.pts.length <= 600);
  assert.deepEqual(problems(line), []);
});

test('drops a non-positive width and keeps a sane one', () => {
  const dropped = normalize(doc([{ pts: [[0, 0], [920, 0]], w: -3 }]));
  assert.equal(dropped.strokes[0]!.w, undefined);
  const kept = normalize(doc([{ pts: [[0, 0], [920, 0]], w: 2.5 }]));
  assert.equal(kept.strokes[0]!.w, 2.5);
});

test('normalize is pure and deterministic', () => {
  const d = doc([{ pts: [[0, 0], [0, 920], [920, 920]] }]);
  const before = structuredClone(d);
  const a = normalize(d);
  const b = normalize(d);
  assert.deepEqual(d, before);
  assert.deepEqual(a, b);
  assert.equal(a.meta.seed, 1);
  assert.equal(a.box[0], 1000);
});

test('join reverses a stroke when that shortens the connector', () => {
  const out = joinToSingleLine(
    doc(
      [
        { pts: [[0, 0], [10, 0]] },
        { pts: [[10, 80], [10, 40]] },
      ],
      'line',
    ),
  );
  assert.deepEqual(out.strokes[0]!.pts, [
    [0, 0],
    [10, 0],
    [10, 40],
    [10, 80],
  ]);
  assert.equal(out.mode, 'line');
  assert.equal(out.strokes.length, 1);
  assert.deepEqual(problems(out), []);
});

test('join keeps stroke order and the original direction on a tie', () => {
  const ordered = joinToSingleLine(
    doc(
      [
        { pts: [[0, 0], [10, 0]] },
        { pts: [[10, 50], [10, 80]] },
        { pts: [[12, 0], [30, 0]] },
      ],
      'sketch',
    ),
  );
  assert.deepEqual(ordered.strokes[0]!.pts, [
    [0, 0],
    [10, 0],
    [10, 50],
    [10, 80],
    [12, 0],
    [30, 0],
  ]);
  const tie = joinToSingleLine(
    doc(
      [
        { pts: [[10, 10], [10, 0]] },
        { pts: [[5, 0], [15, 0]] },
      ],
      'line',
    ),
  );
  assert.deepEqual(tie.strokes[0]!.pts, [
    [10, 10],
    [10, 0],
    [5, 0],
    [15, 0],
  ]);
});

test('join does not mutate its input and leaves a single stroke alone', () => {
  const d = doc([{ pts: [[0, 0], [10, 0], [10, 10]] }], 'line');
  const before = structuredClone(d);
  const out = joinToSingleLine(d);
  assert.deepEqual(d, before);
  assert.deepEqual(out.strokes[0]!.pts, d.strokes[0]!.pts);
  assert.deepEqual(joinToSingleLine(doc([], 'line')).strokes, []);
});

test('a long line is resampled to at most 600 points', () => {
  const pts = Array.from({ length: 700 }, (_, i) => [i, 10] as [number, number]);
  const out = joinToSingleLine(doc([{ pts }], 'line'));
  const got = out.strokes[0]!.pts;
  assert.ok(got.length <= 600);
  assert.ok(got.length >= 590);
  assert.deepEqual(got[0], [0, 10]);
  assert.deepEqual(got.at(-1), [699, 10]);
  assert.deepEqual(problems(out), []);
});

test('line mode is one stroke only after join', () => {
  const d = doc(
    [
      { pts: [[0, 0], [920, 0]] },
      { pts: [[920, 0], [920, 460]] },
    ],
    'line',
  );
  const n = normalize(d);
  assert.equal(n.strokes.length, 2);
  assert.ok(problems(n).some((p) => p.includes('strokes')));
  const j = joinToSingleLine(n);
  assert.equal(j.strokes.length, 1);
  assert.equal(j.mode, 'line');
  assert.deepEqual(problems(j), []);
  assert.equal(j.meta.seed, 1);
});

test('joinNearest takes the nearest remaining stroke next, joinToSingleLine keeps drawing order', () => {
  const d = doc(
    [
      { pts: [[0, 0], [10, 0]] },
      { pts: [[100, 0], [110, 0]] },
      { pts: [[12, 0], [20, 0]] },
    ],
    'sketch',
  );
  assert.deepEqual(joinNearest(d).strokes[0]!.pts, [
    [0, 0],
    [10, 0],
    [12, 0],
    [20, 0],
    [100, 0],
    [110, 0],
  ]);
  assert.deepEqual(joinToSingleLine(d).strokes[0]!.pts, [
    [0, 0],
    [10, 0],
    [100, 0],
    [110, 0],
    [20, 0],
    [12, 0],
  ]);
});
