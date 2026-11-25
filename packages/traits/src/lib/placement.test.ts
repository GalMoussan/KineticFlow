import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetDoc, seedOf } from '@reel/core';
import { autoCap, autoPlacement, fitInto, framePlacement, MIN_FREE, overlapArea, rotatedBounds, TEXT_MARGIN, type Rect } from './placement.ts';

// 9:16 safe area (D17)
const SAFE: Rect = { x: 70, y: 220, w: 890, h: 1320 };
const PRESET = autoCap(SAFE, true);
const DRAWING = autoCap(SAFE, false);
const inside = (r: Rect, s: Rect) => r.x >= s.x - 1e-9 && r.y >= s.y - 1e-9 && r.x + r.w <= s.x + s.w + 1e-9 && r.y + r.h <= s.y + s.h + 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const inflate = (t: Rect, m: number) => ({ x: t.x - m, y: t.y - m, w: t.w + 2 * m, h: t.h + 2 * m });

test('placement auto: an empty safe area takes the capped size, centred (presets 45 % of the safe width)', () => {
  const p = autoPlacement([1000, 500], SAFE, [], 27, PRESET);
  assert.equal(p.fallback, false);
  assert.ok(near(p.rect.w, 0.45 * 890));
  assert.ok(near(p.rect.x + p.rect.w / 2, SAFE.x + SAFE.w / 2) && near(p.rect.y + p.rect.h / 2, SAFE.y + SAFE.h / 2));
  const d = autoPlacement([1000, 500], SAFE, [], 27, DRAWING);
  assert.ok(near(d.rect.w, 0.7 * 890));
});

test('placement auto: text in the top half → the drawing goes into the empty bottom region at a useful size', () => {
  // a 4-line text block filling the top half of the safe area
  const text: Rect[] = [
    { x: 100, y: 260, w: 830, h: 140 },
    { x: 640, y: 420, w: 290, h: 130 },
    { x: 100, y: 570, w: 830, h: 140 },
    { x: 100, y: 730, w: 470, h: 150 },
  ];
  for (const [box, cap] of [[[1000, 878], DRAWING], [[1000, 640], PRESET], [[1000, 960], PRESET]] as const) {
    const p = autoPlacement(box, SAFE, text, 27, cap);
    assert.equal(p.fallback, false);
    assert.ok(inside(p.rect, SAFE));
    assert.ok(p.rect.y >= 880 + 27 - 1e-9, `placed at y ${p.rect.y}: not below the text`);
    for (const t of text) assert.equal(overlapArea(p.rect, inflate(t, 27)), 0);
    // useful: the cap or the free region's height decides, not a sliver beside the text
    const want = Math.min(cap.w / box[0], cap.h / box[1], (1540 - 907) / box[1]) * box[0];
    assert.ok(Math.abs(p.rect.w - want) < 1e-6, `${box}: width ${p.rect.w}, want ${want}`);
    assert.ok(near(p.rect.w / p.rect.h, box[0] / box[1]));
  }
});

test('placement auto: equal bands above and below the text (within 3 %) → below; sub-pixel noise does not pick a corner', () => {
  // kinetic-quote body hold (9:16): text centred, ≈ 322 px free above and ≈ 321 px below; boxes differ by < 1 px
  const text: Rect[] = [
    { x: 532, y: 575, w: 400, h: 123 }, { x: 98, y: 574, w: 392, h: 125 }, { x: 98, y: 850, w: 834, h: 336 },
    { x: 531, y: 569, w: 407, h: 127 }, { x: 90, y: 569.49, w: 398, h: 128 }, { x: 91, y: 848, w: 848, h: 344 },
  ];
  const p = autoPlacement([1000, 878], SAFE, text, 27, DRAWING);
  assert.ok(p.rect.y > 1192, `placed at y ${p.rect.y}`);
  const cx = p.rect.x + p.rect.w / 2;
  assert.ok(Math.abs(cx - (SAFE.x + SAFE.w / 2)) < 2, `not centred in the band: centre x ${cx}`);
});

test('placement auto: deterministic, independent of obstacle order', () => {
  const text: Rect[] = [
    { x: 100, y: 300, w: 400, h: 200 },
    { x: 600, y: 900, w: 300, h: 400 },
    { x: 80, y: 1200, w: 500, h: 100 },
  ];
  assert.deepEqual(autoPlacement([500, 500], SAFE, text, 20, PRESET), autoPlacement([500, 500], SAFE, [...text].reverse(), 20, PRESET));
});

test('placement auto: no room wider than 18 % of the safe width → centred fallback (under the text)', () => {
  const text: Rect[] = [{ x: 70 + 0.1 * 890, y: 220 + 0.1 * 1320, w: 0.8 * 890, h: 0.8 * 1320 }];
  const p = autoPlacement([1000, 1000], SAFE, text, 0, PRESET);
  assert.equal(p.fallback, true);
  assert.ok(inside(p.rect, SAFE));
  assert.ok(near(p.rect.x + p.rect.w / 2, SAFE.x + SAFE.w / 2));
  // just above the threshold it still finds the free band
  const band = MIN_FREE * 890 + 2;
  const q = autoPlacement([1000, 300], SAFE, [{ x: 70, y: 220 + band, w: 890, h: 1320 - band }], 0, PRESET);
  assert.equal(q.fallback, false);
  assert.ok(q.rect.y + q.rect.h <= 220 + band + 1e-9);
});

test('placement auto: a wide drawing in a short wide band is usable (underline in an empty 1000×150 band)', () => {
  const safe: Rect = { x: 0, y: 0, w: 1000, h: 800 };
  const u = presetDoc('underline', 'sketch', 1);
  const p = autoPlacement(u.box, safe, [{ x: 0, y: 150, w: 1000, h: 650 }], 0, autoCap(safe, true));
  assert.equal(p.fallback, false);
  assert.ok(near(p.rect.w, 450), `width ${p.rect.w}`);
  assert.ok(p.rect.y + p.rect.h <= 150 + 1e-9);
});

test('placement auto: the review case (he kinetic-quote 1:1 arrow) finds free space instead of falling back', () => {
  // hold boxes of location-5 in 1:1, as the stills log printed them; out/sketch/P1-review/arrow-1x1.ts
  const safe: Rect = { x: 110, y: 120, w: 860, h: 840 };
  const text: Rect[] = [
    { x: 130, y: 283, w: 510, h: 189 },
    { x: 131, y: 509, w: 818, h: 232 },
    { x: 132, y: 764, w: 818, h: 130 },
  ];
  const d = presetDoc('arrow', 'sketch', seedOf('arrow-here'));
  const m = TEXT_MARGIN * 1080;
  const p = autoPlacement(d.box, safe, text, m, autoCap(safe, true));
  assert.equal(p.fallback, false);
  assert.ok(inside(p.rect, safe));
  for (const t of text) assert.equal(overlapArea(p.rect, inflate(t, m)), 0);
  assert.ok(p.rect.w >= MIN_FREE * safe.w, `width ${p.rect.w}`);
});

test('placement frame: fits x, y, w of the safe area, clamped by the remaining height (16:9)', () => {
  const safe: Rect = { x: 160, y: 100, w: 1600, h: 880 };
  const r = framePlacement([963, 1000], { x: 0.56, y: 0.6, w: 0.42 }, safe);
  assert.ok(inside(r, safe), JSON.stringify(r));
  assert.ok(near(r.y, 100 + 0.6 * 880));
  assert.ok(near(r.h, 880 - 0.6 * 880));
  assert.ok(near(r.w / r.h, 963 / 1000));
  const wide = framePlacement([1000, 160], { x: 0.1, y: 0.1, w: 0.5 }, safe);
  assert.ok(near(wide.w, 800) && near(wide.x, 160 + 160));
});

test('placement: rotation bounds and fit helpers', () => {
  const r = { x: 0, y: 0, w: 100, h: 50 };
  const b = rotatedBounds(r, 90);
  assert.ok(near(b.w, 50) && near(b.h, 100) && near(b.x, 25) && near(b.y, -25));
  assert.deepEqual(rotatedBounds(r, 0), r);
  assert.deepEqual(fitInto([2, 1], { x: 0, y: 0, w: 100, h: 100 }), { x: 0, y: 25, w: 100, h: 50 });
  assert.equal(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
});
