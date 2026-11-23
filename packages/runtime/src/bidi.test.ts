import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bidi, visualOrder } from './bidi.ts';

const words = (xs: string[], order: number[]) => order.map((i) => xs[i]).join(' ');

/** The line as bidi-js lays it out (characters in visual order), for comparison with the placed pieces. */
function bidiLine(xs: string[], dir: 'rtl' | 'ltr'): string {
  const line = xs.join(' ');
  return bidi.getReorderedIndices(line, bidi.getEmbeddingLevels(line, dir)).map((i) => line[i]).join('');
}
/** Placed pieces rendered the same way: each piece's own characters in its own visual order. */
function placed(xs: string[], dir: 'rtl' | 'ltr'): string {
  return visualOrder(xs, dir)
    .map((i) => bidiLine([xs[i]!], dir))
    .join(' ');
}

test('an LTR run inside an RTL line keeps reading left to right', () => {
  const xs = ['ערב', 'Open', 'Mic', '2026'];
  assert.deepEqual(visualOrder(xs, 'rtl'), [1, 2, 3, 0]);
  assert.equal(words(xs, visualOrder(xs, 'rtl')), 'Open Mic 2026 ערב');
  assert.equal(placed(xs, 'rtl'), bidiLine(xs, 'rtl'));
});

test('a Hebrew run inside an English line reads right to left', () => {
  const xs = ['Meet', 'at', 'בית', 'החאן', 'tonight'];
  assert.deepEqual(visualOrder(xs, 'ltr'), [0, 1, 3, 2, 4]);
  assert.equal(placed(xs, 'ltr'), bidiLine(xs, 'ltr'));
});

test('pure lines: RTL reverses, LTR keeps; numbers after Hebrew sit to its left', () => {
  assert.deepEqual(visualOrder(['קפה', 'דילמה', 'וג׳אם'], 'rtl'), [2, 1, 0]);
  assert.deepEqual(visualOrder(['Dilemma', 'Café'], 'ltr'), [0, 1]);
  assert.deepEqual(visualOrder(['בשעה', '19:30'], 'rtl'), [1, 0]);
  const xs = ['\u200F', 'בית', 'Open', 'Mic'];
  assert.deepEqual(visualOrder(xs, 'rtl'), [2, 3, 1, 0], 'an RLM stand-in (pin) leads an RTL line on the right');
});

test('trailing punctuation does not move a piece: the comma follows its word', () => {
  assert.deepEqual(visualOrder(['Beit', 'HaChan,'], 'rtl'), [0, 1]);
  assert.deepEqual(visualOrder(['בית', 'החאן,'], 'rtl'), [1, 0]);
  assert.deepEqual(visualOrder(['בואו,', 'נשב,'], 'rtl'), [1, 0]);
  assert.deepEqual(visualOrder(['Come', 'sit,', 'talk'], 'ltr'), [0, 1, 2]);
  assert.deepEqual(visualOrder(['ערב', '!Open', 'Mic?'], 'rtl'), [1, 2, 0]);
});
