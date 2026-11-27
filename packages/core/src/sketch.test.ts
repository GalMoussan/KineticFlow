import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { presetDoc } from './presets.ts';
import { seedOf } from './seed.ts';
import {
  canonicalJson,
  HOUSE_SKETCH_LOOK,
  resolveSketchLook,
  sectionSketchLook,
  SKETCH_PRESETS,
  SketchDoc,
  sketchDocHash,
  sketchSvg,
  styleSketchLook,
  type SketchRecipes,
} from './sketch.ts';
import { JobSpec } from './spec.ts';
import { StyleRecipe, TRAIT_AXES } from './style.ts';

test('presets: all 8 in both modes are valid SketchDocs; line mode is one stroke', () => {
  for (const p of SKETCH_PRESETS) {
    for (const mode of ['sketch', 'line'] as const) {
      const d = presetDoc(p, mode, 12345);
      const r = SketchDoc.safeParse(d);
      assert.ok(r.success, `${p}/${mode}: ${r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      assert.equal(d.mode, mode);
      if (mode === 'line') assert.equal(d.strokes.length, 1, `${p} line`);
      for (const s of d.strokes) for (let i = 1; i < s.pts.length; i++) assert.notDeepEqual(s.pts[i], s.pts[i - 1], `${p}: repeated point`);
    }
  }
  assert.equal(presetDoc('burst', 'sketch', 1).strokes.length, 16);
  assert.equal(presetDoc('arrow', 'sketch', 1).strokes.length, 2);
});

test('presets: deterministic, byte-identical across calls, varied by seed', () => {
  for (const p of SKETCH_PRESETS) {
    const a = JSON.stringify(presetDoc(p, 'sketch', seedOf('sk-1')));
    const b = JSON.stringify(presetDoc(p, 'sketch', seedOf('sk-1')));
    assert.equal(a, b, p);
    assert.notEqual(a, JSON.stringify(presetDoc(p, 'sketch', seedOf('sk-2'))), `${p}: the seed must vary the jitter`);
  }
});

test('presets: golden hashes (bit-exact arithmetic: a change in any point changes these)', () => {
  const got = Object.fromEntries(
    SKETCH_PRESETS.map((p) => [p, createHash('sha256').update(canonicalJson([presetDoc(p, 'sketch', 7), presetDoc(p, 'line', 7)])).digest('hex').slice(0, 16)]),
  );
  const want = JSON.parse(readFileSync(new URL('./fixtures/preset-hashes.json', import.meta.url), 'utf8'));
  assert.deepEqual(got, want);
});

test('presets: the generator uses only + − × ÷ sqrt (no transcendental Math, no Math.random)', () => {
  const src = readFileSync(new URL('./presets.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|hypot|cbrt|random)\b/);
  assert.doesNotMatch(src, /\*\*/);
});

test('SketchDoc: limits, integer points inside the box, line = one stroke', () => {
  const ok = presetDoc('check', 'sketch', 1);
  assert.ok(SketchDoc.safeParse(ok).success);
  const bad = (f: (d: SketchDoc) => void) => {
    const d = structuredClone(ok);
    f(d);
    return SketchDoc.safeParse(d).success;
  };
  assert.equal(bad((d) => (d.box = [1001, 500])), false);
  assert.equal(bad((d) => (d.strokes[0]!.pts[0] = [1.5, 2])), false);
  assert.equal(bad((d) => (d.strokes[0]!.pts[0] = [ok.box[0], ok.box[1] + 1])), false);
  assert.equal(bad((d) => ((d.mode = 'line'), d.strokes.push({ pts: [[0, 0], [1, 1]] }))), false);
  assert.equal(bad((d) => (d.strokes = Array.from({ length: 401 }, () => ({ pts: [[0, 0], [1, 1]] })))), false);
  assert.equal(bad((d) => (d.strokes = Array.from({ length: 31 }, () => ({ pts: Array.from({ length: 200 }, (_, i) => [i % 800, 3] as [number, number]) })))), false);
});

test('SketchDoc hash: sha256 of the canonical JSON, independent of key order', async () => {
  const d = presetDoc('star', 'sketch', 3);
  const shuffled = JSON.parse(JSON.stringify({ meta: d.meta, strokes: d.strokes, mode: d.mode, box: d.box, v: d.v }));
  const h = await sketchDocHash(d);
  assert.equal(h, await sketchDocHash(shuffled));
  assert.equal(h, createHash('sha256').update(canonicalJson(d)).digest('hex'));
  assert.match(sketchSvg(d), /^<svg [^>]*viewBox="0 0 1000 960"/);
});

test('SketchLook: house default, then overrides in order; undefined fields are skipped', () => {
  assert.deepEqual(resolveSketchLook(), HOUSE_SKETCH_LOOK);
  const l = resolveSketchLook({ width: 2, exit: 'undraw' }, { width: 1.5, color: undefined });
  assert.equal(l.width, 1.5);
  assert.equal(l.exit, 'undraw');
  assert.equal(l.color, HOUSE_SKETCH_LOOK.color);
});

/** Two styles with opposite looks (and one without a block). */
const LOOKS: SketchRecipes = {
  neon: { sketch: { width: 1.2, rough: 0.3, boil: true, glow: 1, drawBeats: 1, ease: 'snap', exit: 'fade', color: 'text', sfx: 'scribble' } },
  luxe: { sketch: { presetMode: 'line', width: 0.5, rough: 0, boil: false, glow: 0, drawBeats: 4, ease: 'smooth', exit: 'stay', color: 'accent1', sfx: 'none' } },
  plain: {},
};

test('SketchLook from a style: its recipe block over the house default; a style without one is the house look', () => {
  assert.deepEqual(styleSketchLook('plain', LOOKS), HOUSE_SKETCH_LOOK);
  assert.deepEqual(styleSketchLook('neon', LOOKS), { ...HOUSE_SKETCH_LOOK, ...LOOKS.neon!.sketch });
  assert.deepEqual(styleSketchLook({ base: 'luxe', params: { 'material.glow': 1 } }, LOOKS), { ...HOUSE_SKETCH_LOOK, ...LOOKS.luxe!.sketch });
});

test('SketchLook blend: numeric fields lerp, discrete fields come from the dominant style (the trait rule)', () => {
  const at = (mix: number) => styleSketchLook({ base: 'neon', blendWith: { style: 'luxe', mix } }, LOOKS);
  const half = at(0.5);
  assert.deepEqual([half.width, half.rough, half.glow, half.drawBeats], [0.85, 0.15, 0.5, 2.5]);
  // 50 % → the partner dominates (mix ≥ 0.5), like the traits
  assert.deepEqual([half.presetMode, half.boil, half.ease, half.exit, half.color, half.sfx], ['line', false, 'smooth', 'stay', 'accent1', 'none']);
  const low = at(0.3);
  assert.ok(Math.abs(low.width - (1.2 + (0.5 - 1.2) * 0.3)) < 1e-12 && Math.abs(low.drawBeats - 1.9) < 1e-12);
  assert.deepEqual([low.presetMode, low.boil, low.ease, low.exit, low.color, low.sfx], ['sketch', true, 'snap', 'fade', 'text', 'scribble']);
  assert.deepEqual(at(0), styleSketchLook('neon', LOOKS));
  assert.deepEqual(at(1), styleSketchLook('luxe', LOOKS));
});

test('SketchLook resolution order: house → section style (own, else the job) → job sketchLook → sketch look', () => {
  const spec = { style: 'neon', sketchLook: { width: 2, exit: 'undraw' as const } };
  // the job's style, then the job's sketchLook over it
  const job = sectionSketchLook(spec, {}, { look: undefined }, LOOKS);
  assert.deepEqual(job, { ...HOUSE_SKETCH_LOOK, ...LOOKS.neon!.sketch, width: 2, exit: 'undraw' });
  // the sketch's own look wins over everything
  assert.equal(sectionSketchLook(spec, {}, { look: { width: 3 } }, LOOKS).width, 3);
  // a section with its own style resolves from that style (replacing the job's, not stacking on it)
  const own = sectionSketchLook({ style: 'neon' }, { style: 'luxe' }, undefined, LOOKS);
  assert.deepEqual(own, styleSketchLook('luxe', LOOKS));
  assert.equal(own.boil, false);
  // … with its own blend
  const blended = sectionSketchLook({ style: 'luxe' }, { style: { base: 'plain', blendWith: { style: 'neon', mix: 0.5 } } }, undefined, LOOKS);
  assert.equal(blended.boil, true);
  assert.equal(blended.drawBeats, (HOUSE_SKETCH_LOOK.drawBeats + 1) / 2);
});

test('recipe `sketch` block: optional; validated field by field (ranges, enums, unknown keys)', () => {
  const recipe = {
    id: 'x',
    name: 'X',
    families: ['simple'],
    energy: 1,
    background: 'light',
    traits: Object.fromEntries(TRAIT_AXES.map((a) => [a, 'x'])),
    params: {},
    defaults: { palette: 'p', music: { preset: 'm', bpm: 100 }, fonts: { display: 'rubik' } },
    constraints: { maxWordsPerSection: 5, formats: ['9:16'], roles: ['title'] },
    choreography: { unitBeats: 1, shortUnitBeats: 0.5, moveBeats: 1, leadIn: 0.2, minTail: 0.6, entry: 0.6, endUnitBeats: 0.5, endHold: 2, introBeats: 1, outroBeats: 1 },
  };
  assert.ok(StyleRecipe.safeParse(recipe).success);
  assert.ok(StyleRecipe.safeParse({ ...recipe, sketch: { glow: 1, exit: 'undraw' } }).success);
  for (const sketch of [{ width: 5 }, { rough: -0.1 }, { drawBeats: 0 }, { ease: 'bounce' }, { color: 'accent7' }, { glw: 1 }]) {
    assert.equal(StyleRecipe.safeParse({ ...recipe, sketch }).success, false, JSON.stringify(sketch));
  }
});

// ───────────────────────────── spec validation ─────────────────────────────

/** A raw (unparsed) spec: sections are plain records so tests can attach anything, valid or not. */
const base = () => ({
  id: 'sk',
  language: 'he',
  contentType: 'event',
  sections: [
    { role: 'title', text: 'קפה *דילמה*' },
    { role: 'tagline', text: 'בואו לדבר' },
    { role: 'body', text: 'הכל טוב' },
    { role: 'endcard', logos: [] },
  ] as Record<string, unknown>[],
  style: 'kinetic-quote',
  palette: 'flamingo-cafe',
  fonts: { display: 'rubik' },
  music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1 },
  duration: 30,
  formats: ['9:16'],
});
const issues = (spec: unknown) => {
  const r = JobSpec.safeParse(spec);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};
const preset = (id: string, extra: object = {}) => ({ id, source: { kind: 'preset', preset: 'circle' }, ...extra });

test('spec: without sketches it parses exactly as before (no new keys)', () => {
  const s = JobSpec.parse(base());
  for (const sec of s.sections) assert.equal('sketches' in sec, false);
  assert.equal('drawLogo' in s.sections.at(-1)!, false);
});

test('spec: sketches parse with defaults; until must name a later section with an explicit id', () => {
  const ok = base();
  ok.sections[1]!.sketches = [preset('a', { until: 'body-2' })];
  assert.match(issues(ok).join('\n'), /sections\.1\.sketches\.0\.until: "until" needs section "body-2" to have an explicit "id"/);
  ok.sections[2]!.id = 'body-2';
  const sec = JobSpec.parse(ok).sections[1]!;
  assert.ok(sec.role !== 'endcard' && sec.sketches);
  assert.deepEqual(sec.sketches[0]!.place, { mode: 'auto' });

  const back = base();
  back.sections[1]!.sketches = [preset('a', { until: 'title-0' })];
  assert.match(issues(back).join('\n'), /sections\.1\.sketches\.0\.until: "until" must name a later section/);
  const none = base();
  none.sections[1]!.sketches = [preset('a', { until: 'nope' })];
  assert.match(issues(none).join('\n'), /names no section/);
});

test('spec: word placement must point at a content item; limits per section and job; ids unique', () => {
  const word = base();
  word.sections[0]!.sketches = [preset('a', { place: { mode: 'word', item: 1, fit: 'around' } })];
  assert.deepEqual(issues(word), []);
  word.sections[0]!.sketches = [preset('a', { place: { mode: 'word', item: 5, fit: 'around' } })];
  assert.match(issues(word).join('\n'), /sections\.0\.sketches\.0\.place\.item: section "title-0" has no word at item 5 \(it has 2 text item\(s\)\)/);

  const four = base();
  four.sections[1]!.sketches = ['a', 'b', 'c', 'd'].map((id) => preset(id));
  assert.match(issues(four).join('\n'), /at most 3 sketches per section/);

  const many = base();
  many.sections = [
    many.sections[0]!,
    ...Array.from({ length: 5 }, (_, i) => ({ role: 'body', text: `טקסט ${i}`, sketches: ['a', 'b', 'c'].map((x) => preset(`${x}${i}`)) })),
    many.sections.at(-1)!,
  ];
  assert.match(issues(many).join('\n'), /15 sketches; a video has at most 12/);

  const dup = base();
  dup.sections[1]!.sketches = [preset('a')];
  dup.sections[2]!.sketches = [preset('a')];
  assert.match(issues(dup).join('\n'), /duplicate sketch id "a"/);
});

test('spec (P5): word placement: sub-line words follow the big words; part must name a word of the item; no until', () => {
  const sub = base();
  // tagline: 2 big words, then the sub line's 3 words are items 2..4
  sub.sections[1] = { role: 'tagline', text: 'בואו *לדבר*', sub: 'על הכל *היום*' };
  sub.sections[1]!.sketches = [preset('a', { place: { mode: 'word', item: 4, fit: 'under' } })];
  assert.deepEqual(issues(sub), []);
  sub.sections[1]!.sketches = [preset('a', { place: { mode: 'word', item: 5, fit: 'under' } })];
  assert.match(issues(sub).join('\n'), /sections\.1\.sketches\.0\.place\.item: section "tagline-1" has no word at item 5 \(it has 5 text item\(s\)\)/);

  // `part`: a word inside a multi-word item (a list item, a city); one-word items take only part 0
  const list = base();
  list.sections[1] = { role: 'list', items: ['שוק הפשפשים ביפו', 'קפה'] };
  list.sections[1]!.sketches = [preset('a', { place: { mode: 'word', item: 0, part: 2, fit: 'around' } })];
  assert.deepEqual(issues(list), []);
  list.sections[1]!.sketches = [preset('a', { place: { mode: 'word', item: 0, part: 3, fit: 'around' } })];
  assert.match(issues(list).join('\n'), /sections\.1\.sketches\.0\.place\.part: item 0 \("שוק הפשפשים ביפו"\) has 3 word\(s\); "part" must be below 3/);
  list.sections[1]!.sketches = [preset('a', { place: { mode: 'word', item: 1, part: 1, fit: 'around' } })];
  assert.match(issues(list).join('\n'), /place\.part: item 1 \("קפה"\) has 1 word\(s\)/);

  // any text item can carry a word sketch, e.g. a datetime's time (item 2)
  const date = base();
  date.sections[2] = { role: 'datetime', date: '2026-12-01', time: '19:30' };
  date.sections[2]!.sketches = [preset('a', { place: { mode: 'word', item: 2, fit: 'under' } })];
  assert.deepEqual(issues(date), []);

  // a word sketch leaves with its word: `until` is rejected for it (and only for it)
  const until = base();
  until.sections[2]!.id = 'body-2';
  until.sections[1]!.sketches = [preset('a', { until: 'body-2', place: { mode: 'word', item: 0, fit: 'around' } })];
  assert.match(issues(until).join('\n'), /sections\.1\.sketches\.0\.until: a sketch on a word leaves with its word.s section; remove "until"/);
  until.sections[1]!.sketches = [preset('a', { until: 'body-2' })];
  assert.deepEqual(issues(until), []);
});

test('spec: end card takes drawLogo but no sketches; logo line sketches are not available yet', () => {
  const end = base();
  end.sections[3] = { role: 'endcard', logos: [], drawLogo: true };
  const card = JobSpec.parse(end).sections[3]!;
  assert.ok(card.role === 'endcard' && card.drawLogo === true);
  end.sections[3]!.sketches = [preset('a')];
  assert.match(issues(end).join('\n'), /the end card has no sketches/);

  const logo = base();
  logo.sections[1]!.sketches = [{ id: 'l', source: { kind: 'logo', asset: 'ayalim' } }];
  assert.match(issues(logo).join('\n'), /sections\.1\.sketches\.0\.source: drawing a logo.s line version is not available yet/);
});

test('spec: job-level sketchLook is optional and validated; a job without it parses exactly as before', () => {
  const plain = JobSpec.parse(base());
  assert.equal('sketchLook' in plain, false);
  const tuned = base() as Record<string, unknown>;
  tuned.sketchLook = { width: 1.5, boil: true, exit: 'undraw', sfx: 'none' };
  assert.deepEqual(JobSpec.parse(tuned).sketchLook, tuned.sketchLook);
  for (const bad of [{ width: 0.1 }, { drawBeats: 20 }, { exit: 'vanish' }, { wobble: true }]) {
    assert.equal(JobSpec.safeParse({ ...base(), sketchLook: bad }).success, false, JSON.stringify(bad));
  }
});
