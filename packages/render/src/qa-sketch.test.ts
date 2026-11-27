import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, type OverlayBox, type TextBox } from '@reel/core';
import { gateSketches, type GateResult } from './qa.ts';

// 9:16: safe area x 70–960, y 220–1540
const input = { format: format('9:16') };
const word: TextBox = { section: 'tagline-1', unit: 2, text: 'מעניינים', x: 300, y: 700, w: 400, h: 120 };
const above: TextBox = { section: 'tagline-1', unit: 1, text: 'הכי', x: 500, y: 560, w: 200, h: 120 };
/** A sketch drawn around `word` (its box holds the word with a margin). */
const circle = (extra: Partial<OverlayBox> = {}): OverlayBox => ({
  id: 'circle-word',
  section: 'tagline-1',
  place: 'word',
  item: 2,
  anchor: 'shown',
  layer: 'over',
  fallback: false,
  visible: true,
  x: 260,
  y: 680,
  w: 480,
  h: 160,
  ...extra,
});
/** The same drawing, not attached to a word. */
const { item: _item, anchor: _anchor, ...unattached } = circle();
const gate = (overlays: OverlayBox[], boxes: TextBox[] = [word, above]): GateResult => {
  const r = gateSketches([{ t: 9.97, boxes, overlays }], input);
  assert.ok(r);
  return r;
};
/** One of the gate's string lists (`covers`, `wordOutside`, `notes`). */
function list(r: GateResult, key: string): string[] {
  const d = r.data;
  if (!d || typeof d !== 'object' || !(key in d)) return [];
  const v: unknown = Reflect.get(d, key);
  return Array.isArray(v) ? v.map(String) : [];
}

test('sketch QA (P5): a word sketch may cover its own word; the same box placed automatically warns', () => {
  const own = gate([circle()]);
  assert.equal(own.level, 'pass', own.detail);
  assert.deepEqual(list(own, 'covers'), []);
  const auto = gate([{ ...unattached, id: 'circle-hot', place: 'auto' }]);
  assert.equal(auto.level, 'warn');
  assert.match(list(auto, 'covers').join('; '), /circle-hot covers 100 % of "מעניינים"/);
});

test('sketch QA (P5): a word sketch still warns when it covers other words beyond the threshold', () => {
  // grows up into "הכי": 40 of its 120 px height over its 200 px width = 33 %
  const r = gate([circle({ y: 640, h: 200 })]);
  assert.equal(r.level, 'warn');
  assert.match(list(r, 'covers').join('; '), /circle-word covers 33 % of "הכי"/);
  assert.doesNotMatch(list(r, 'covers').join('; '), /מעניינים/);
  // the word with the same item index in another section is another word
  const other: TextBox = { ...word, section: 'body-2' };
  assert.match(list(gate([circle()], [other]), 'covers').join('; '), /covers 100 % of "מעניינים"/);
});

test('sketch QA (P5): a word sketch leaving the safe area warns (a frame sketch fails)', () => {
  const r = gate([circle({ x: 30, w: 700 })]);
  assert.equal(r.level, 'warn');
  assert.deepEqual(list(r, 'wordOutside'), ['circle-word (word) [30,680 → 730,840] leaves the safe area @9.97s']);
  assert.equal(gate([{ ...unattached, place: 'frame', x: 30, w: 700 }]).level, 'fail');
});

test('sketch QA (P5): a hidden or off-screen word hides its sketch; the gate notes it and checks nothing else', () => {
  const r = gate([circle({ visible: false, anchor: 'offscreen', y: 640, h: 200 })]);
  assert.equal(r.level, 'pass');
  assert.deepEqual(list(r, 'notes'), ['circle-word: its word is off screen @9.97s, the sketch hides with it']);
  assert.match(r.detail, /its word is off screen/);
  assert.deepEqual(list(gate([circle({ visible: false, anchor: 'hidden' })]), 'notes'), ['circle-word: its word is hidden @9.97s, the sketch hides with it']);
  // outside its time window there is no anchor state and nothing to note
  assert.deepEqual(list(gate([{ ...unattached, place: 'word', item: 2, visible: false }]), 'notes'), []);
});

test('sketch QA (P5 review): with `part`, only that word of a multi-word item is exempt, not the whole item', () => {
  // a list item "שוק הפשפשים ביפו" (one box); the circle sits on its last word (the left third) and spills over the middle one
  const item: TextBox = { section: 'list-2', unit: 0, text: 'שוק הפשפשים ביפו', x: 100, y: 700, w: 600, h: 100 };
  const onPart = (extra: Partial<OverlayBox>) => circle({ section: 'list-2', item: 0, part: 2, word: { x: 100, y: 700, w: 200, h: 100 }, y: 690, h: 120, ...extra });
  // drawn round its word only: nothing reported
  assert.deepEqual(list(gate([onPart({ x: 80, w: 240 })], [item]), 'covers'), []);
  // reaching 120 px into the other words (120 × 100 of the 400 × 100 left) = 30 %
  assert.match(list(gate([onPart({ x: 80, w: 340 })], [item]), 'covers').join('; '), /circle-word covers 30 % of "שוק הפשפשים ביפו"/);
});

test('sketch QA (P5 review r3): an `around` ring covers its band, not its box', () => {
  // the ring round "מעניינים" with a 8 px pen: its inner edge holds the box x 346–654, y 714–806
  const ring = (extra: Partial<OverlayBox> = {}) => circle({ fit: 'around', pen: 8, ...extra });
  const inside: TextBox = { section: 'tagline-1', unit: 3, text: 'בתוך', x: 380, y: 720, w: 240, h: 80 };
  const r = gate([ring()], [word, inside]);
  assert.equal(r.level, 'pass', r.detail);
  assert.deepEqual(list(r, 'covers'), []);
  // the same box read as solid covers all of it
  assert.match(list(gate([circle()], [word, inside]), 'covers').join('; '), /circle-word covers 100 % of "בתוך"/);
  // a neighbour under the ring's line: 200 × 60 in the box less 134 × 46 in the hole = 49 %
  const crossed: TextBox = { ...inside, x: 280, y: 700, w: 200, h: 60 };
  const c = gate([ring()], [word, crossed]);
  assert.equal(c.level, 'warn');
  assert.match(list(c, 'covers').join('; '), /circle-word covers 49 % of "בתוך"/);
});
