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
  SKETCH_PRESETS,
  SketchDoc,
  sketchDocHash,
  sketchSvg,
} from './sketch.ts';
import { JobSpec } from './spec.ts';

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
  assert.match(issues(word).join('\n'), /sections\.0\.sketches\.0\.place\.item: section "title-0" has no content item 5/);

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
