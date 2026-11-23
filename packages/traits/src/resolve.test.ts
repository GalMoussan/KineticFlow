import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { JobSpec, PALETTES, StyleRecipe, TRAIT_AXES, type JobSpecInput, type TraitMeta } from '@reel/core';
import { RECIPES } from '@reel/styles';
import { resolveStyles, TRAIT_META, usedTraits, type StyleResolution } from './index.ts';

const kq = RECIPES['kinetic-quote']!;

/** Test-only traits: a non-world camera and layout (so fallbacks and compat errors can be exercised). */
const STATIC_CAMERA: TraitMeta = { id: 'static', axis: 'camera', layer: 'dom', label: 'Static', params: {} };
const STACK: TraitMeta = {
  id: 'stack',
  axis: 'layout',
  layer: 'dom',
  label: 'Stack',
  roles: ['title', 'tagline', 'body', 'cta', 'datetime', 'endcard'],
  params: { gap: { min: 0, max: 100, default: 20, label: 'Gap' } },
};
const META: TraitMeta[] = [...TRAIT_META, STATIC_CAMERA, STACK];

const recipeOf = (over: Partial<StyleRecipe> & { id: string }): StyleRecipe =>
  StyleRecipe.parse({ ...kq, ...over, traits: { ...kq.traits, ...over.traits }, params: over.params ?? kq.params });

const hot = recipeOf({ id: 'kq-hot', params: { 'camera.drift': 0.12, 'rhythm.kick': 0.02, 'rhythm.decay': 10 }, traits: { ...kq.traits, motion: 'overshoot' } });
const stacked = recipeOf({ id: 'stacked', traits: { ...kq.traits, camera: 'static', layout: 'stack', transition: 'camera-move' }, params: {} });
/** kinetic-quote traits with another default palette. */
const night = recipeOf({ id: 'night', defaults: { ...kq.defaults, palette: 'neon-night' } });
const RECIPES_T = { ...RECIPES, 'kq-hot': hot, stacked, night };

const SECTIONS: JobSpecInput['sections'] = [
  { role: 'title', text: 'קפה דילמה' },
  { role: 'tagline', text: 'הכי *חמים*' },
  { role: 'cta', text: 'בואו' },
  { role: 'endcard', logos: [] },
];
const spec = (o: Partial<JobSpecInput> = {}) =>
  JobSpec.parse({
    id: 'test',
    language: 'he',
    contentType: 'event',
    sections: SECTIONS,
    style: 'kinetic-quote',
    palette: 'flamingo-cafe',
    fonts: { display: 'rubik' },
    music: { source: 'none' },
    duration: 20,
    formats: ['9:16'],
    ...o,
  });
const resolve = (o: Partial<JobSpecInput> = {}): StyleResolution => resolveStyles(spec(o), RECIPES_T, META);
const errors = (r: StyleResolution) => r.diagnostics.filter((d) => d.level === 'error');

test('kinetic-quote resolves cleanly into one world chain with every trait param filled in', () => {
  const r = resolveStyles(spec(), RECIPES, TRAIT_META);
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.scenes, [{ sections: ['title-0', 'tagline-1', 'cta-2', 'endcard-3'], world: true }]);
  const st = r.sections['title-0']!;
  assert.equal(st.recipe, 'kinetic-quote');
  assert.equal(st.params['camera.drift'], 0.04);
  assert.equal(st.params['rhythm.kick'], 0.008);
  assert.equal(st.params['layout.lead'], 30, 'a param the recipe does not set takes the trait default');
  for (const axis of TRAIT_AXES) {
    const m = TRAIT_META.find((t) => t.axis === axis && t.id === st.traits[axis])!;
    for (const p of Object.keys(m.params)) assert.ok(`${axis}.${p}` in st.params, `${axis}.${p}`);
  }
});

test('blend: numeric params lerp at mix; a value missing on one side takes that side’s trait default', () => {
  const r = resolve({ style: { base: 'kinetic-quote', blendWith: { style: 'kq-hot', mix: 0.25 } } });
  assert.deepEqual(errors(r), []);
  const p = r.sections['title-0']!.params;
  assert.equal(p['camera.drift'], 0.04 + (0.12 - 0.04) * 0.25);
  assert.equal(p['rhythm.kick'], 0.008 + (0.02 - 0.008) * 0.25);
  assert.equal(p['rhythm.decay'], 6 + (10 - 6) * 0.25, 'base does not set decay: land-kick default 6');
  assert.equal(p['layout.lead'], 30);
  assert.equal(r.job!.params['camera.drift'], p['camera.drift']);
});

test('blend: discrete traits come from the dominant style (mix < 0.5 → base)', () => {
  const below = resolve({ style: { base: 'kinetic-quote', blendWith: { style: 'kq-hot', mix: 0.49 } } });
  assert.equal(below.sections['title-0']!.traits.motion, 'smooth');
  assert.equal(below.sections['title-0']!.recipe, 'kinetic-quote');
  const at = resolve({ style: { base: 'kinetic-quote', blendWith: { style: 'kq-hot', mix: 0.5 } } });
  assert.equal(at.sections['title-0']!.traits.motion, 'overshoot');
  assert.equal(at.sections['title-0']!.recipe, 'kq-hot');
  assert.equal(at.sections['title-0']!.params['motion.overshoot'], 1);
});

test('overrides: spec traits replace the recipe’s, spec params override blended values', () => {
  const r = resolve({ style: { base: 'kinetic-quote', traits: { motion: 'overshoot' }, params: { 'motion.overshoot': 2, 'camera.drift': 0.1 } } });
  assert.deepEqual(errors(r), []);
  const st = r.sections['cta-2']!;
  assert.equal(st.traits.motion, 'overshoot');
  assert.equal(st.params['motion.overshoot'], 2);
  assert.equal(st.params['camera.drift'], 0.1);
});

test('per section: a section style resolves on its own; the others keep the job style', () => {
  const sections = structuredClone(SECTIONS);
  sections[2] = { role: 'cta', text: 'בואו', style: { base: 'kinetic-quote', params: { 'material.tilt': 3 } } };
  const r = resolve({ sections });
  assert.deepEqual(errors(r), []);
  assert.equal(r.sections['cta-2']!.params['material.tilt'], 3);
  assert.equal(r.sections['tagline-1']!.params['material.tilt'], -1.4);
  assert.deepEqual(r.scenes.map((s) => s.sections.length), [4], 'material params do not break the world chain');
});

test('compat: requires/excludes, roles, unknown traits and params are errors naming the offending axis pair', () => {
  const r = resolve({ style: { base: 'kinetic-quote', traits: { camera: 'static' } } });
  const req = errors(r).find((d) => d.code === 'requires')!;
  assert.match(req.message, /layout:world-blocks requires camera ∈ \{pan-turn\}, got camera:static/);
  assert.deepEqual(req.sections, ['title-0', 'tagline-1', 'cta-2', 'endcard-3']);
  assert.deepEqual(r.sections, {}, 'no styles when there are errors');

  const roles = resolve({ style: 'stacked', sections: [...SECTIONS.slice(0, 2), { role: 'list', items: ['a', 'b'] }, SECTIONS[3]!] });
  assert.match(errors(roles).find((d) => d.code === 'role')!.message, /layout:stack cannot lay out role "list"/);

  const unknown = resolve({ style: { base: 'kinetic-quote', traits: { reveal: 'nope' }, params: { 'camera.zoom': 1 } } });
  assert.ok(errors(unknown).some((d) => d.code === 'unknown-trait' && /reveal trait "nope"/.test(d.message)));

  const param = resolve({ style: { base: 'kinetic-quote', params: { 'camera.zoom': 1, 'rhythm.kick': 9 } } });
  assert.ok(errors(param).some((d) => d.code === 'unknown-param' && /camera\.zoom/.test(d.message)));
  assert.ok(errors(param).some((d) => d.code === 'param-range' && /rhythm\.kick" = 9 is outside \[0, 0\.05\]/.test(d.message)));

  const fmt = resolve({ formats: ['9:16'], style: 'missing' });
  assert.equal(errors(fmt)[0]!.code, 'unknown-style');
});

test('signature axes cannot be overridden', () => {
  const sig = recipeOf({ id: 'sig', signature: { module: 'board', owns: ['reveal', 'unit'] } });
  const r = resolveStyles(spec({ style: { base: 'sig', traits: { reveal: 'kinetic-mix' } } }), { ...RECIPES_T, sig }, META);
  assert.match(errors(r)[0]!.message, /axis reveal belongs to its signature module "board"/);
});

test('fallback: camera-move into a non-world section becomes a cut, recorded as a warning; world chains split', () => {
  const sections = structuredClone(SECTIONS);
  sections[2] = { role: 'cta', text: 'בואו', style: 'stacked' };
  const r = resolve({ sections });
  assert.deepEqual(errors(r), []);
  const warn = r.diagnostics.filter((d) => d.code === 'transition-fallback');
  assert.equal(warn.length, 2, 'into the stacked section, and back into the world');
  assert.deepEqual(warn.map((d) => d.sections), [['cta-2'], ['endcard-3']]);
  assert.match(warn[0]!.message, /transition:camera-move into "cta-2" is invalid .* falling back to transition:cut/);
  assert.equal(r.sections['cta-2']!.traits.transition, 'cut');
  assert.equal(r.sections['endcard-3']!.traits.transition, 'cut');
  assert.equal(r.sections['tagline-1']!.traits.transition, 'camera-move');
  assert.deepEqual(r.scenes, [
    { sections: ['title-0', 'tagline-1'], world: true },
    { sections: ['cta-2'], world: false },
    { sections: ['endcard-3'], world: true },
  ]);

  // Different camera params cannot share one camera: the chain splits (and falls back to a cut).
  const drift = structuredClone(SECTIONS);
  drift[1] = { role: 'tagline', text: 'הכי *חמים*', style: { base: 'kinetic-quote', params: { 'camera.drift': 0.1 } } };
  const d = resolve({ sections: drift });
  assert.deepEqual(d.scenes.map((s) => s.sections), [['title-0'], ['tagline-1'], ['cta-2', 'endcard-3']]);
  assert.match(d.diagnostics[0]!.message, /layout\/camera\/background or palette differ/);
});

test('palettes: the job palette for the job style, a section style’s own default otherwise, section palette wins', () => {
  const flamingo = PALETTES['flamingo-cafe']!;
  const plain = resolve();
  for (const st of Object.values(plain.sections)) assert.deepEqual(st.palette, flamingo);
  assert.deepEqual(plain.job!.palette, flamingo);

  const sections = structuredClone(SECTIONS);
  sections[1] = { role: 'tagline', text: 'הכי *חמים*', style: 'night' };
  sections[2] = { role: 'cta', text: 'בואו', style: 'night', palette: 'latte' };
  sections[3] = { role: 'endcard', logos: [], palette: 'ink-paper' };
  const own = { bg: '#101010', text: '#FAFAFA', accents: ['#FF0000'] };
  const r = resolve({ sections, palette: own });
  assert.deepEqual(errors(r), []);
  assert.deepEqual(r.sections['title-0']!.palette, own, 'job style: the spec palette (explicit colours)');
  assert.deepEqual(r.sections['tagline-1']!.palette, PALETTES['neon-night'], 'other style: its default palette');
  assert.deepEqual(r.sections['cta-2']!.palette, PALETTES.latte, 'section palette beats the style default');
  assert.deepEqual(r.sections['endcard-3']!.palette, PALETTES['ink-paper'], 'section palette beats the job palette');
  // same traits and params, different palettes: one world each (a layer has one palette)
  assert.deepEqual(r.scenes.map((s) => s.sections), [['title-0'], ['tagline-1'], ['cta-2'], ['endcard-3']]);

  // a blend's dominant recipe decides whose default applies
  const blend = structuredClone(SECTIONS);
  blend[1] = { role: 'tagline', text: 'הכי *חמים*', style: { base: 'kinetic-quote', blendWith: { style: 'night', mix: 0.6 } } };
  assert.deepEqual(resolve({ sections: blend }).sections['tagline-1']!.palette, PALETTES['neon-night']);

  const bad = structuredClone(SECTIONS);
  bad[1] = { role: 'tagline', text: 'הכי *חמים*', palette: 'no-such-palette' };
  const e = errors(resolve({ sections: bad }));
  assert.equal(e[0]!.code, 'unknown-palette');
  assert.deepEqual(e[0]!.sections, ['tagline-1']);
});

test('usedTraits lists each trait once, in axis order', () => {
  const sections = structuredClone(SECTIONS);
  sections[2] = { role: 'cta', text: 'בואו', style: 'stacked' };
  const used = usedTraits(resolve({ sections }));
  assert.deepEqual(
    used.map((t) => `${t.axis}:${t.id}`),
    [
      'rhythm:land-kick', 'camera:pan-turn', 'camera:static', 'layout:stack', 'layout:world-blocks', 'unit:word',
      'reveal:kinetic-mix', 'motion:smooth', 'axis:none', 'material:flat', 'background:paper-grid',
      'transition:camera-move', 'transition:cut',
    ],
  );
});

test('registry: every trait folder is registered and its impl carries the registered meta', async () => {
  const root = new URL('./traits/', import.meta.url);
  const folders: string[] = [];
  for (const axis of await readdir(root)) for (const id of await readdir(new URL(`${axis}/`, root))) folders.push(`${axis}/${id}`);
  assert.deepEqual(folders.sort(), TRAIT_META.map((m) => `${m.axis}/${m.id}`).sort());
  for (const m of TRAIT_META) {
    // the specifier comes from the registry: this test checks that every registered trait's module loads
    const impl = (await import(`./traits/${m.axis}/${m.id}/impl.ts`)) as { default: { meta: TraitMeta } };
    assert.equal(impl.default.meta, m, `${m.axis}/${m.id}`);
    if (m.axis === 'layout') assert.ok(m.roles?.length, `${m.id} declares roles`);
    for (const [p, s] of Object.entries(m.params)) assert.ok(s.min <= s.default && s.default <= s.max, `${m.id}.${p}`);
  }
});
