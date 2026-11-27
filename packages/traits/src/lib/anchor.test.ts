import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetDoc, seedOf } from '@reel/core';
import { clampFit, FIT_VARIANTS, fitWord, keepOf, partBox, trimOf, unionBox, wordRange, type Box } from './anchor.ts';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const REST = { tx: 0, ty: 0, rot: 0, skx: 0, sx: 1, sy: 1 };

test('word anchor: part k is the k-th whitespace word (the words spec validation counts)', () => {
  const text = 'שוק  הפשפשים, ביפו!';
  assert.deepEqual(wordRange(text, 0), [0, 3]);
  assert.equal(text.slice(...wordRange(text, 1)!), 'הפשפשים,');
  assert.equal(text.slice(...wordRange(text, 2)!), 'ביפו!');
  assert.equal(wordRange(text, 3), null);
  // as many words as `@reel/core` validation counts (`split(/\s+/)` without empties)
  for (const t of ['a', ' a  b ', 'קרית שמונה', '19:30', 'one\ttwo\nthree']) {
    let n = 0;
    while (wordRange(t, n)) n++;
    assert.equal(n, t.split(/\s+/u).filter(Boolean).length, JSON.stringify(t));
  }
});

test('word anchor: per-letter anchors follow each letter part as it moves (union of the moved parts, ink band)', () => {
  const parts: Box[] = [
    { x: 0, y: -20, w: 50, h: 140 },
    { x: 50, y: -20, w: 40, h: 140 },
  ];
  const band: [number, number] = [10, 100];
  // at rest: the parts' horizontal extent, the word's ink band vertically
  assert.deepEqual(unionBox(parts.map((p) => partBox(p, band, REST))), { x: 0, y: 10, w: 90, h: 90 });
  // a letter moved by its own channels (a path style carrying it): the anchor grows to keep it
  const moved = unionBox([partBox(parts[0]!, band, REST), partBox(parts[1]!, band, { ...REST, tx: 30, ty: -40 })])!;
  assert.deepEqual(moved, { x: 0, y: -30, w: 120, h: 130 });
  // a quarter turn about the part's centre swaps its extent
  const turned = partBox({ x: 0, y: 0, w: 100, h: 40 }, null, { ...REST, rot: 90 });
  assert.ok(near(turned.x, 30) && near(turned.y, -30) && near(turned.w, 40) && near(turned.h, 100), JSON.stringify(turned));
  // uniform scale about the centre
  const big = partBox({ x: 0, y: 0, w: 100, h: 40 }, null, { ...REST, sx: 2, sy: 2 });
  assert.ok(near(big.x, -50) && near(big.w, 200) && near(big.y, -20) && near(big.h, 80));
  assert.equal(unionBox([]), null);
});

const CIRCLE = presetDoc('circle', 'sketch', seedOf('c')).box;
const UNDERLINE = presetDoc('underline', 'sketch', seedOf('u')).box;
const ARROW = presetDoc('arrow', 'sketch', seedOf('a')).box;
interface Ellipse {
  cx: number;
  cy: number;
  a: number;
  b: number;
}
/** The preset circle's ellipse inside a fitted rect (94 % × 90.6 % of it, centred). */
const ellipse = (r: Box): Ellipse => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, a: (0.94 * r.w) / 2, b: (0.906 * r.h) / 2 });
const inside = (e: Ellipse, x: number, y: number) => ((x - e.cx) / e.a) ** 2 + ((y - e.cy) / e.b) ** 2 <= 1 + 1e-9;

test('word fit around: an ellipse round the word, centred on it, holding its corners (pad on top)', () => {
  for (const a of [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 40, y: 10, w: 300, h: 100 },
    { x: 0, y: 0, w: 900, h: 150 },
  ]) {
    const f = fitWord(a, a.y + 0.8 * a.h, 'around', undefined, true, CIRCLE);
    const e = ellipse(f.rect);
    assert.ok(near(e.cx, a.x + a.w / 2) && near(e.cy, a.y + a.h / 2));
    for (const [x, y] of [[a.x, a.y], [a.x + a.w, a.y], [a.x, a.y + a.h], [a.x + a.w, a.y + a.h]] as const) assert.ok(inside(e, x, y), `corner ${x},${y} of ${JSON.stringify(a)}`);
    assert.equal(f.flip, false);
    // the overhang beside the word is at most 0.75 h (+ pad) and the height at most 0.95 h each way (+ pad)
    assert.ok(e.a <= a.w / 2 + 0.75 * a.h + 0.08 * a.h + 1e-9);
    assert.ok(e.b <= 0.95 * a.h + 0.08 * a.h + 1e-9);
  }
  // `pad` widens it by exactly that much on each axis
  const a = { x: 0, y: 0, w: 300, h: 100 };
  const tight = ellipse(fitWord(a, 80, 'around', 0, false, CIRCLE).rect);
  const padded = ellipse(fitWord(a, 80, 'around', 12, false, CIRCLE).rect);
  assert.ok(near(padded.a - tight.a, 12) && near(padded.b - tight.b, 12));
  // the narrowest variant (no room beside a full-width word) keeps the ellipse within the word's width + pad
  const narrow = ellipse(fitWord({ x: 0, y: 0, w: 900, h: 150 }, 120, 'around', 0, true, CIRCLE, { spread: 0 }).rect);
  assert.ok(near(narrow.a, 450));
  assert.deepEqual(FIT_VARIANTS.around[0], { spread: 1 });
});

test('word fit under: the word\u2019s width, its ink starting just below the baseline', () => {
  const a = { x: 20, y: 0, w: 400, h: 100 };
  const { rect, flip } = fitWord(a, 85, 'under', undefined, true, UNDERLINE);
  // the preset's ink runs from 3 % to 97 % of its box: exactly the word's width
  assert.ok(near(rect.x + 0.03 * rect.w, a.x) && near(rect.x + 0.97 * rect.w, a.x + a.w));
  // its first stroke (33 % down its box) sits below the baseline, at most 0.45 h tall
  const top = rect.y + 0.33 * rect.h;
  assert.ok(top > 85 && top < 85 + 0.2 * a.h, `ink top ${top}`);
  assert.ok(rect.h <= 0.45 * a.h + 1e-9);
  assert.equal(flip, false);
});

test('word fit beside: on the reading start side, pointing at the word (RTL: right, mirrored)', () => {
  const a = { x: 300, y: 100, w: 200, h: 100 };
  const tip = (r: Box, flip: boolean) => ({ x: r.x + (flip ? 0.08 : 0.92) * r.w, y: r.y + 0.5 * r.h });
  const rtl = fitWord(a, 180, 'beside', undefined, true, ARROW);
  assert.equal(rtl.flip, true);
  assert.ok(rtl.rect.x > a.x + a.w - 0.08 * rtl.rect.w, 'RTL: on the right');
  const t1 = tip(rtl.rect, true);
  assert.ok(near(t1.x, a.x + a.w + 0.12 * a.h) && near(t1.y, a.y + a.h / 2), JSON.stringify(t1));
  const ltr = fitWord(a, 180, 'beside', undefined, false, ARROW);
  assert.equal(ltr.flip, false);
  const t2 = tip(ltr.rect, false);
  assert.ok(near(t2.x, a.x - 0.12 * a.h) && near(t2.y, a.y + a.h / 2));
  assert.ok(ltr.rect.x + ltr.rect.w <= a.x + 0.08 * ltr.rect.w + 1e-9, 'LTR: on the left');
  // the end side is the other side; above turns it to point down at the word's top
  assert.deepEqual(fitWord(a, 180, 'beside', undefined, true, ARROW, { side: 'end' }), ltr);
  const up = fitWord(a, 180, 'beside', undefined, true, ARROW, { side: 'above' });
  assert.equal(up.turn, true);
  assert.ok(near(up.rect.y + 0.92 * up.rect.h, a.y - 0.12 * a.h), 'tip just above the word');
});

test('word fit around, hug: the ellipse crosses the word\u2019s ends and keeps 0.15 h above and below', () => {
  const a = { x: 0, y: 0, w: 900, h: 150 };
  assert.deepEqual(FIT_VARIANTS.around.at(-1), { spread: 0, hug: true });
  const e = ellipse(fitWord(a, 120, 'around', 0, true, CIRCLE, { spread: 0, hug: true }).rect);
  assert.ok(near(e.cx, 450) && near(e.cy, 75));
  assert.ok(near(e.a, 450) && near(e.b, 75 + 0.15 * 150), JSON.stringify(e));
  // a pad larger than 0.15 h wins on both axes
  const p = ellipse(fitWord(a, 120, 'around', 30, true, CIRCLE, { spread: 0, hug: true }).rect);
  assert.ok(near(p.a, 480) && near(p.b, 105));
});

test('word fit clamp: a fitted box cut to the safe limits, side by side, always holding the word\u2019s centre lines', () => {
  const word = { x: 100, y: 200, w: 300, h: 100 };
  const fitted = fitWord(word, 280, 'around', undefined, true, CIRCLE);
  const r = fitted.rect;
  const within = (b: Box, l: number, rr: number, t: number, bt: number) => b.x >= l - 1e-9 && b.x + b.w <= rr + 1e-9 && b.y >= t - 1e-9 && b.y + b.h <= bt + 1e-9;
  const holds = (b: Box) => b.x <= 250 && b.x + b.w >= 250 && b.y <= 250 && b.y + b.h >= 250;
  for (const [l, rr, t, bt] of [
    [r.x - 10, r.x + r.w + 10, r.y - 10, r.y + r.h + 10], // inside already: unchanged
    [120, 1000, -1000, 1000], // the left limit cuts into the word
    [-1000, 300, 230, 290], // right, top and bottom
    [240, 260, 245, 255], // a sliver round the centre
  ] as const) {
    const c = clampFit(r, word, l, rr, t, bt);
    assert.ok(within(c, Math.max(l, r.x), Math.min(rr, r.x + r.w), Math.max(t, r.y), Math.min(bt, r.y + r.h)), JSON.stringify([l, rr, t, bt, c]));
    assert.ok(holds(c), JSON.stringify(c));
    // never grows
    assert.ok(within(c, r.x, r.x + r.w, r.y, r.y + r.h));
  }
  const same = clampFit(r, word, r.x - 10, r.x + r.w + 10, r.y - 10, r.y + r.h + 10);
  assert.ok(near(same.x, r.x) && near(same.y, r.y) && near(same.w, r.w) && near(same.h, r.h));
  // limits past the centre line: that side stops on it
  const past = clampFit(r, word, 300, 1000, -1000, 1000);
  assert.ok(near(past.x, 250) && near(past.x + past.w, r.x + r.w));
  // the page keeps the cut as a `trim` of the fit: the same box at rest, the same shares when the word moves
  const cut = clampFit(r, word, 120, 1000, -1000, 1000);
  const v = { trim: trimOf(r, cut) };
  const again = fitWord(word, 280, 'around', undefined, true, CIRCLE, v).rect;
  assert.ok(near(again.x, cut.x) && near(again.y, cut.y) && near(again.w, cut.w) && near(again.h, cut.h), JSON.stringify([again, cut]));
  // beside keeps the arrow's tip, not the word (the arrow sits off it)
  const arrow = fitWord(word, 280, 'beside', undefined, false, ARROW);
  const tip = keepOf(arrow, 'beside', word);
  assert.ok(near(tip.x, word.x - 0.12 * word.h) && near(tip.y, 250));
  assert.equal(keepOf(fitted, 'around', word), word);
});
