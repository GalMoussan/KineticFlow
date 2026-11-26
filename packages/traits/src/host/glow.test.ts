import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JobSpec, materialGlow, sectionSketchLook, sketchGlow, type StyleRef } from '@reel/core';
import { RECIPES } from '@reel/styles';
import { resolveStyles, TRAIT_META } from '../index.ts';

const event = JSON.parse(readFileSync(new URL('../../../../examples/test-set/event-he.json', import.meta.url), 'utf8'));

/** A sketch's stroke glow strength next to its section's text glow strength, for a job style ref. */
function glows(style: StyleRef): { stroke: number; text: number; material: string } {
  const spec = JobSpec.parse({ ...event, style });
  const res = resolveStyles(spec, RECIPES, TRAIT_META);
  const section = spec.sections[1]!;
  const st = res.sections[section.id]!;
  assert.ok(st, JSON.stringify(res.diagnostics));
  const look = sectionSketchLook(spec, section, undefined, RECIPES);
  const s = sketchGlow(st.traits.material, st.params, look.glow);
  return { stroke: s ? s.p * s.k : 0, text: materialGlow(st.traits.material, st.params)?.p ?? 0, material: st.traits.material };
}

test('sketch glow = text glow: every catalog style, blends, material Fine-tune and material overrides', () => {
  const cases: [string, StyleRef][] = [
    ...Object.keys(RECIPES).map((id): [string, StyleRef] => [id, id]),
    ['neon ↔ luxe 0.3', { base: 'neon-psychedelic', blendWith: { style: 'minimal-luxe', mix: 0.3 } }],
    ['neon ↔ luxe 0.5', { base: 'neon-psychedelic', blendWith: { style: 'minimal-luxe', mix: 0.5 } }],
    ['neon ↔ kinetic-quote 0.6', { base: 'neon-psychedelic', blendWith: { style: 'kinetic-quote', mix: 0.6 } }],
    ['luxe + material.glow 1', { base: 'minimal-luxe', params: { 'material.glow': 1 } }],
    ['kinetic-quote + material neon-glow', { base: 'kinetic-quote', traits: { material: 'neon-glow' } }],
    ['neon + material flat', { base: 'neon-psychedelic', traits: { material: 'flat' } }],
  ];
  for (const [name, ref] of cases) {
    const g = glows(ref);
    assert.ok(Math.abs(g.stroke - g.text) < 1e-12, `${name} (${g.material}): stroke glow ${g.stroke} vs text ${g.text}`);
  }
  // the cases that must glow do, the flat ones don't
  assert.ok(glows({ base: 'kinetic-quote', traits: { material: 'neon-glow' } }).stroke > 0);
  assert.ok(glows({ base: 'minimal-luxe', params: { 'material.glow': 1 } }).stroke === 1);
  assert.equal(glows({ base: 'neon-psychedelic', traits: { material: 'flat' } }).stroke, 0);
});
