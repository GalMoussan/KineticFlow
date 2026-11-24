/**
 * The ported contour morph (`geom.ts`, M0d `own.union`): matching, end states, determinism of the path strings, and
 * the spike's clean letter pairs shaped with harfbuzz in Node (skipped when the catalog font is not downloaded).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  contoursFromPolygons,
  glyphContours,
  hungarian,
  linkHoles,
  morph,
  pathRings,
  rectRing,
  selfIntersections,
  unionContours,
  type Contour,
  type Ring,
} from './geom.ts';
import { loadFont, outline, shapeText, type Hb } from './shape.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const KS = Array.from({ length: 61 }, (_, i) => i / 60);

/** A square frame (outer + square hole) next to a bar: 2 outers, 1 hole. */
function frameAndBar(x: number): Contour[] {
  const outer = rectRing(x, 0, 100, 100);
  const hole: Ring = [...rectRing(x + 30, 30, 40, 40)].reverse();
  const bar = rectRing(x + 120, 0, 20, 100);
  return unionContours(linkHoles([...glyphContours([outer, hole]), ...glyphContours([bar])]));
}

/** An "O"-like octagon frame (outer + hole), wider, plus a smaller square overlapping a second square. */
function octagonAndOverlap(): Contour[] {
  const oct: Ring = [[40, 0], [100, 0], [140, 40], [140, 80], [100, 120], [40, 120], [0, 80], [0, 40]];
  const hole: Ring = [[50, 30], [90, 30], [110, 60], [90, 90], [50, 90], [30, 60]].reverse() as Ring;
  // two overlapping squares: the union must merge them into one outer
  const a = rectRing(170, 20, 40, 40);
  const b = rectRing(190, 40, 40, 40);
  return unionContours(linkHoles([...glyphContours([oct, hole]), ...glyphContours([a]), ...glyphContours([b])]));
}

test('hungarian: minimum-cost assignment, rectangular', () => {
  assert.deepEqual(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), [1, 0, 2]);
  assert.deepEqual(hungarian([[1, 9], [9, 1], [5, 5]]), [0, 1, -1]);
  assert.deepEqual(hungarian([[9, 1, 5]]), [1]);
});

test('union: overlaps merge, holes stay holes (outer +, hole −)', () => {
  const cs = octagonAndOverlap();
  assert.equal(cs.filter((c) => c.outer).length, 2);
  assert.equal(cs.filter((c) => !c.outer).length, 1);
  const hole = cs.find((c) => !c.outer)!;
  assert.ok(cs[hole.parent]!.outer && cs[hole.parent]!.holes.includes(cs.indexOf(hole)));
  assert.equal(contoursFromPolygons([]).length, 0);
});

test('morph: outers pair by position, holes inside paired parents, extras none', () => {
  const A = frameAndBar(0);
  const B = octagonAndOverlap();
  const m = morph(A, B);
  const outer = (cs: Contour[], i: number) => cs[i]!.outer;
  assert.equal(m.info.pairs.length, 3);
  for (const [a, b] of m.info.pairs) assert.equal(outer(A, a), outer(B, b), 'outer ↔ outer, hole ↔ hole');
  // the frame (left) goes to the octagon (left), the bar (right) to the merged squares (right)
  const frameA = A.findIndex((c) => c.outer && c.holes.length);
  const octB = B.findIndex((c) => c.outer && c.holes.length);
  assert.ok(m.info.pairs.some(([a, b]) => a === frameA && b === octB));
  assert.deepEqual([m.info.extrasA, m.info.extrasB], [[], []]);
});

test('morph: exact end states, 0.01 px rounding, no twisting', () => {
  const m = morph(frameAndBar(0), octagonAndOverlap());
  assert.equal(m.path(0), m.dA);
  assert.equal(m.path(1), m.dB);
  assert.equal(m.path(-0.5), m.dA);
  for (const k of KS.slice(1, -1)) {
    const d = m.path(k);
    assert.match(d, /^(M-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?(L-?\d+(\.\d{1,2})?,-?\d+(\.\d{1,2})?)*Z)+$/);
    assert.equal(selfIntersections(pathRings(d)), 0, `k=${k}`);
  }
});

test('morph: same k ⇒ same path string (seek order, rebuild)', () => {
  const m1 = morph(frameAndBar(0), octagonAndOverlap());
  const forward = KS.map((k) => m1.path(k));
  const shuffled = [...KS.keys()].sort((a, b) => ((a * 37) % 61) - ((b * 37) % 61));
  const m2 = morph(frameAndBar(0), octagonAndOverlap());
  for (const i of shuffled) assert.equal(m2.path(KS[i]!), forward[i]);
  // pinned: catches unintended changes to matching, resampling, alignment or rounding (no transcendental Math here,
  // so the strings are identical in every engine)
  assert.equal(sha(forward.join('|')), '1f9224bbdee0ae33');
  assert.equal(forward[30]!.length, 4301);
});

test('morph: unmatched contours shrink and grow at their anchors', () => {
  const A = frameAndBar(0);
  const B = frameAndBar(0).slice(0, 2); // the frame only (outer + hole)
  const m = morph(A, B);
  assert.equal(m.info.extrasA.length, 1);
  // the bar is gone after the shrink window (0.6), present (scaled) before it
  assert.equal(pathRings(m.path(0.3)).length, 3);
  assert.equal(pathRings(m.path(0.7)).length, 2);
  const back = morph(B, A);
  assert.equal(pathRings(back.path(0.3)).length, 2);
  assert.equal(pathRings(back.path(0.7)).length, 3);
});

const RUBIK = new URL('../../../../../assets/fonts/Rubik[wght].ttf', import.meta.url).pathname;

test('harfbuzz letters (Rubik): ם→ס and B→8 morph without self-crossings', { skip: !existsSync(RUBIK) && 'catalog font not downloaded' }, async () => {
  const hb = (await createRequire(import.meta.url)('harfbuzzjs')) as Hb;
  const font = loadFont(hb, new Uint8Array(readFileSync(RUBIK)));
  const letter = (t: string) => {
    const sh = shapeText(font, t, 200, 400, /[\u05D0-\u05EA]/.test(t) ? 'rtl' : 'ltr');
    return outline(sh, -sh.width / 2, 0);
  };
  for (const [a, b, holes] of [['ם', 'ס', 1], ['B', '8', 2]] as const) {
    const A = letter(a);
    const B = letter(b);
    assert.equal(A.clusters.length, 1);
    assert.equal(B.all.filter((c) => !c.outer).length, holes, `${b} holes after union`);
    const m = morph(A.all, B.all);
    assert.deepEqual([m.info.extrasA, m.info.extrasB], [[], []], `${a}→${b}: 1:1 contours`);
    const frames = KS.map((k) => m.path(k));
    for (const d of frames.slice(1, -1)) assert.equal(selfIntersections(pathRings(d)), 0, `${a}→${b}`);
    assert.deepEqual(KS.map((k) => morph(letter(a).all, letter(b).all).path(k)), frames, 'rebuild from the font');
  }
  // niqqud: שָׁלוֹם → 4 clusters (marks stay with their letters)
  const sh = shapeText(font, 'שָׁלוֹם', 100, 700, 'rtl');
  assert.equal(outline(sh, 0, 0).clusters.length, 4);
});
