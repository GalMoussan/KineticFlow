import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, HOUSE_SKETCH_LOOK, PALETTES, SketchLook, styleSketchLook } from '@reel/core';
import { RECIPES } from './index.ts';

test('every catalog style owns a complete, valid sketch look', () => {
  assert.equal(Object.keys(RECIPES).length, 54);
  for (const r of Object.values(RECIPES)) {
    assert.ok(r.sketch, `${r.id}: no sketch block`);
    assert.deepEqual(Object.keys(r.sketch).sort(), Object.keys(HOUSE_SKETCH_LOOK).filter((k) => k !== 'mirrorRtl').sort(), `${r.id}: incomplete block`);
    assert.ok(SketchLook.safeParse(styleSketchLook(r.id, RECIPES)).success, r.id);
  }
});

test('a style sketch colour reads on its own default palette (≥ 3:1)', () => {
  for (const r of Object.values(RECIPES)) {
    const p = PALETTES[r.defaults.palette]!;
    const c = r.sketch!.color!;
    const hex = c === 'text' ? p.text : p.accents[Number(c.slice(6)) % p.accents.length]!;
    assert.ok(contrast(hex, p.bg) >= 3, `${r.id}: ${c} ${hex} on ${p.bg}`);
  }
});

test('the catalog looks are varied: both preset modes, every exit, glow, boil and every sound', () => {
  const looks = Object.values(RECIPES).map((r) => styleSketchLook(r.id, RECIPES));
  for (const [field, values] of [
    ['presetMode', ['sketch', 'line']],
    ['exit', ['stay', 'fade', 'undraw']],
    ['ease', ['smooth', 'functional', 'snap']],
    ['sfx', ['scribble', 'pop', 'none']],
    ['boil', [true, false]],
  ] as const) {
    for (const v of values) assert.ok(looks.some((l) => l[field] === v), `no style with ${field} = ${v}`);
  }
  assert.ok(looks.some((l) => l.glow > 0) && looks.some((l) => l.rough >= 0.5));
});
