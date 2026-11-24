import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bandTimes, centerPhrase, easeOut3, foldBox, foldK, foldWindows, hermite, smoothstep, span01 } from './scroll.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('hermite hits its ends and its end tangents', () => {
  const h = (k: number) => hermite(2, 10, 4, -6, k);
  close(h(0), 2);
  close(h(1), 10);
  const eps = 1e-4;
  close((h(eps) - h(0)) / eps, 4, 1e-2);
  close((h(1) - h(1 - eps)) / eps, -6, 1e-2);
});

test('easeOut3 and smoothstep sit on 0 and 1', () => {
  close(easeOut3(0), 0);
  close(easeOut3(1), 1);
  close(easeOut3(-2), 0);
  close(easeOut3(3), 1);
  close(smoothstep(0), 0);
  close(smoothstep(1), 1);
  assert.ok(easeOut3(0.2) > 0.2);
});

test('foldBox is whole pixels: a crease when shut, the full panel when open, centred', () => {
  const shut = foldBox(200.4, 0, 4);
  assert.deepEqual(shut, { size: 4, inset: 98 });
  const open = foldBox(200.4, 1, 4);
  assert.deepEqual(open, { size: 200, inset: 0 });
  const mid = foldBox(101, 0.5, 4);
  assert.equal(mid.size, 4 + Math.round((101 - 4) * 0.5));
  assert.equal(mid.inset, Math.round((101 - mid.size) / 2));
  assert.equal(mid.size % 1, 0);
});

test('centerPhrase puts the chosen copy in the middle of the window', () => {
  const phrase = 100;
  const stride = 140;
  const view = 1000;
  const itx = centerPhrase(phrase, stride, view, 0);
  assert.equal(itx, Math.round(view / 2 - phrase / 2));
  const itx1 = centerPhrase(phrase, stride, view, 1);
  assert.equal(itx1 + stride + phrase / 2, view / 2);
});

test('foldWindows is flat before the hold and foldK drops only while shutting', () => {
  const w = foldWindows(1.2, 2, 4, { t0: 0.4, t1: 1.2 }, { t0: 4, t1: 5.2 });
  assert.ok(w.open1 <= 2 - 0.04, `open1 ${w.open1}`);
  assert.ok(w.open1 >= w.open0 + 0.18);
  assert.equal(w.shut0, 4);
  assert.equal(w.shut1, 4.6);
  close(foldK(w.open1, w), 1);
  close(foldK((w.open1 + w.shut0) / 2, w), 1);
  assert.ok(foldK(w.shut0 + 0.01, w) < 1);
  assert.ok(foldK(w.shut1, w) < 0.02);
  const last = foldWindows(0, 1.2, 8, null, null);
  assert.equal(last.shut0, Number.POSITIVE_INFINITY);
  close(foldK(8, last), 1);
});

test('span01 treats a missing exit (Infinity, Infinity) as not started', () => {
  close(span01(22, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY), 0);
  close(span01(22, 20, Number.POSITIVE_INFINITY), 0);
  close(span01(1, 0, 2), 0.5);
  close(span01(3, 0, 2), 1);
});

test('bandTimes stops the marquee before the hold', () => {
  const w = bandTimes(3, 4, { t0: 2.2, t1: 3 });
  assert.ok(w.scroll1 <= 4 - 0.02);
  assert.ok(w.fade1 === w.scroll1);
  assert.ok(w.scroll0 < w.scroll1);
  assert.ok(w.fade0 <= w.fade1);
});
