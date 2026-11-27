import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JobSpec, type SectionSketchInput, type SketchRecipes } from '@reel/core';
import { RECIPES, recipe } from '@reel/styles';
import { buildCueSheet, TimingError } from './index.ts';

const example = JSON.parse(readFileSync(new URL('../../../examples/dilemma.json', import.meta.url), 'utf8'));
const choreography = recipe('kinetic-quote').choreography;
const BEAT = 0.6; // 100 bpm

/** dilemma at `duration` s with `sketches` added to section `i`; every section gets its default id explicitly (`until` targets need one). */
function withSketches(duration: number, add: Record<number, SectionSketchInput[]>) {
  const raw = structuredClone(example);
  raw.duration = duration;
  raw.sections = raw.sections.map((s: { role: string; id?: string }, i: number) => ({ ...s, id: s.id ?? `${s.role}-${i}` }));
  for (const [i, ks] of Object.entries(add)) raw.sections[Number(i)].sketches = ks;
  return JobSpec.parse(raw);
}
/** Styles without a `sketch` block: every sketch takes the house look, so these tests pin the timing rules alone. */
const HOUSE: SketchRecipes = {};
const sheetOf = (spec: JobSpec, grid?: Parameters<typeof buildCueSheet>[0]['grid'], recipes: SketchRecipes = HOUSE) =>
  buildCueSheet({ spec, choreography, fps: 30, recipes, ...(grid ? { grid } : { bpm: 100 }) });
const circle = (id: string, extra: Partial<SectionSketchInput> = {}): SectionSketchInput => ({ id, source: { kind: 'preset', preset: 'circle' }, ...extra });

test('sketch timing: jobs without sketches (or with empty lists) give exactly the same cue sheet', () => {
  const plain = sheetOf(withSketches(26, {}));
  const empty = sheetOf(withSketches(26, { 1: [], 2: [] }));
  assert.deepEqual(empty, plain);
  assert.equal(plain.cues.filter((c) => c.type === 'sketch-in' || c.type === 'sketch-out').length, 0);
});

test('sketch timing: a hold that already fits keeps every time; the sketch draws from the hold for drawBeats', () => {
  const base = sheetOf(withSketches(40, {}));
  // section 1 holds long enough at 40 s? pick the section with the longest hold among the non-last ones
  const i = base.sections.slice(0, -1).reduce((b, s, k) => (s.timing.out - s.timing.holdStart > base.sections[b]!.timing.out - base.sections[b]!.timing.holdStart ? k : b), 0);
  const s = base.sections[i]!;
  assert.ok(s.timing.out - s.timing.holdStart >= 3 * BEAT - 1e-9, `${s.id} holds ${s.timing.out - s.timing.holdStart} s`);
  const sheet = sheetOf(withSketches(40, { [i]: [circle('c1')] }));
  assert.deepEqual(sheet.sections, base.sections);
  const sin = sheet.cues.find((c) => c.type === 'sketch-in')!;
  const sout = sheet.cues.find((c) => c.type === 'sketch-out')!;
  assert.deepEqual(sin, { t: s.timing.holdStart, type: 'sketch-in', section: s.id, sketch: 'c1', weight: 1, until: Math.round((s.timing.holdStart + 2 * BEAT) * 1e6) / 1e6 });
  // house exit: fade over the last 0.3 s of the section
  assert.deepEqual(sout, { t: Math.round((s.timing.out - 0.3) * 1e6) / 1e6, type: 'sketch-out', section: s.id, sketch: 'c1', weight: 1, until: s.timing.out });
  // the other cues are unchanged and the sheet stays sorted
  assert.deepEqual(sheet.cues.filter((c) => c.sketch === undefined), base.cues);
  for (let k = 1; k < sheet.cues.length; k++) assert.ok(sheet.cues[k]!.t >= sheet.cues[k - 1]!.t);
});

test('sketch timing: budget rule stretches a short hold to start + drawBeats + 1 beats, taking time from other holds', () => {
  const base = sheetOf(withSketches(32, {}));
  const tag = base.sections[1]!;
  assert.ok(tag.timing.out - tag.timing.holdStart < 4 * BEAT, 'tagline must start out too short for the test');
  const spec = withSketches(32, { 1: [circle('c1', { start: { edge: 'hold', beats: 1 }, look: { drawBeats: 2 } })] });
  const sheet = sheetOf(spec);
  const s = sheet.sections[1]!;
  assert.ok(s.timing.out - s.timing.holdStart >= (1 + 2 + 1) * BEAT - 1e-9, `hold ${s.timing.out - s.timing.holdStart}`);
  // same duration, every landing still on the half-beat grid, sections still ordered
  assert.equal(sheet.duration, 32);
  for (const sec of sheet.sections) for (const it of sec.items) assert.ok(Math.abs((it.at - 0.5) / 0.3 - Math.round((it.at - 0.5) / 0.3)) < 1e-6);
  for (let k = 1; k < sheet.sections.length; k++) assert.ok(sheet.sections[k]!.timing.in >= sheet.sections[k - 1]!.timing.out);
  // every other non-last section keeps its minimum tail
  for (const sec of sheet.sections.slice(0, -1)) assert.ok(sec.timing.out - sec.timing.lastLand >= choreography.minTail - 1e-9);
  const sin = sheet.cues.find((c) => c.type === 'sketch-in')!;
  assert.equal(sin.t, Math.round((s.timing.holdStart + BEAT) * 1e6) / 1e6);
  assert.equal(sin.until, Math.round((s.timing.holdStart + 3 * BEAT) * 1e6) / 1e6);
  assert.ok(s.timing.out >= sin.until! + BEAT - 1e-9);
});

test('sketch timing: a sketch that cannot fit is a TimingError naming a longer duration (the text-overrun report)', () => {
  const spec = withSketches(26, { 1: [circle('a', { look: { drawBeats: 8 } })], 2: [circle('b', { look: { drawBeats: 8 } })] });
  assert.throws(() => sheetOf(spec), (e: unknown) => e instanceof TimingError && e.needed > 26 && /bpm/.test(e.message));
});

test('sketch timing: "in" edge, beats offset, until spanning and undraw/stay exits', () => {
  const spec = withSketches(40, {
    1: [circle('span', { until: 'teaser-3', look: { exit: 'undraw' } }), circle('early', { start: { edge: 'in', beats: 0.5 }, look: { exit: 'stay' } })],
  });
  const sheet = sheetOf(spec);
  const s = sheet.sections[1]!;
  const cue = (type: string, id: string) => sheet.cues.find((c) => c.type === type && c.sketch === id)!;
  assert.equal(cue('sketch-in', 'early').t, Math.round((s.timing.in + 0.5 * BEAT) * 1e6) / 1e6);
  assert.deepEqual([cue('sketch-out', 'early').t, cue('sketch-out', 'early').until], [s.timing.out, s.timing.out]);
  const teaser = sheet.sections[3]!;
  assert.deepEqual([cue('sketch-out', 'span').t, cue('sketch-out', 'span').until], [Math.round((teaser.timing.out - 0.5) * 1e6) / 1e6, teaser.timing.out]);
  assert.equal(cue('sketch-out', 'span').section, s.id);
});

test('sketch timing: on a detected grid the budget rule counts local beats', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const beats: number[] = [];
  for (let t = 0.21; t < 41; ) {
    beats.push(Math.round((t + rnd() * 0.008) * 1e4) / 1e4);
    t += 60 / (96 + (36 * t) / 41);
  }
  const grid = { beats, downbeats: beats.filter((_, i) => i % 4 === 1), meterConfidence: 1 };
  const sheet = sheetOf(withSketches(40, { 2: [circle('c', { look: { drawBeats: 3 } })] }), grid);
  const s = sheet.sections[2]!;
  const sin = sheet.cues.find((c) => c.type === 'sketch-in')!;
  // one local beat: between the grid's slowest (96 bpm) and fastest (132 bpm) beat
  const beat = (sin.until! - sin.t) / 3;
  assert.ok(beat > 60 / 133 && beat < 60 / 95, `beat ${beat}`);
  assert.ok(s.timing.out >= sin.until! + beat - 1e-6);
});

test('sketch timing: drawBeats and exit come from the section style, then the job sketchLook, then the sketch look', () => {
  const recipes: SketchRecipes = { 'kinetic-quote': { sketch: { drawBeats: 3, exit: 'stay' } }, 'dilemma-reveal': { sketch: { drawBeats: 1, exit: 'undraw' } } };
  const draw = (spec: JobSpec, id: string) => {
    const sheet = sheetOf(spec, undefined, recipes);
    const sin = sheet.cues.find((c) => c.type === 'sketch-in' && c.sketch === id)!;
    const sout = sheet.cues.find((c) => c.type === 'sketch-out' && c.sketch === id)!;
    return { beats: Math.round(((sin.until! - sin.t) / BEAT) * 1e6) / 1e6, exit: Math.round((sout.until! - sout.t) * 1e6) / 1e6 };
  };
  const spec = withSketches(40, { 1: [circle('a')], 2: [circle('b', { look: { drawBeats: 1.5 } })] });
  assert.equal(spec.style, 'kinetic-quote');
  // the job style's block
  assert.deepEqual(draw(spec, 'a'), { beats: 3, exit: 0 });
  // the sketch's own look wins over the style
  assert.equal(draw(spec, 'b').beats, 1.5);
  // a section with its own style times its sketches from that style
  const own = JobSpec.parse({ ...spec, sections: spec.sections.map((s, i) => (i === 1 ? { ...s, style: 'dilemma-reveal' } : s)) });
  assert.deepEqual(draw(own, 'a'), { beats: 1, exit: 0.5 });
  // the job's sketchLook sits between the style and the sketch
  const job = JobSpec.parse({ ...spec, sketchLook: { drawBeats: 2.5 } });
  assert.equal(draw(job, 'a').beats, 2.5);
  assert.equal(draw(job, 'b').beats, 1.5);
});

test('sketch timing: a job with sketches needs the recipes; one without never reads them', () => {
  const spec = withSketches(40, { 1: [circle('a')] });
  assert.throws(() => buildCueSheet({ spec, choreography, fps: 30, bpm: 100 }), /needs the style recipes/);
  const plain = withSketches(26, {});
  assert.deepEqual(buildCueSheet({ spec: plain, choreography, fps: 30, bpm: 100 }), buildCueSheet({ spec: plain, choreography, fps: 30, bpm: 100, recipes: RECIPES }));
});

// ───────────────────────────── word attachment (P5) ─────────────────────────────

const ENTRY = choreography.entry;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const onWord = (id: string, item: number, extra: Partial<SectionSketchInput> = {}): SectionSketchInput =>
  circle(id, { place: { mode: 'word', item, fit: 'around' }, ...extra });

test('word sketch timing: drawing starts once its word has landed and settled (at + entry), then its own beats', () => {
  // tagline: "הנושאים הכי *מעניינים* ו*חמים* היום!" — items land one after another
  const spec = withSketches(40, {
    1: [onWord('w0', 0, { start: { edge: 'in' } }), onWord('w2', 2, { start: { edge: 'in', beats: 0.5 } }), onWord('wh', 4)],
  });
  const sheet = sheetOf(spec);
  const s = sheet.sections[1]!;
  const sin = (id: string) => sheet.cues.find((c) => c.type === 'sketch-in' && c.sketch === id)!;
  assert.ok(s.items[0]!.at < s.items[2]!.at && s.items[2]!.at < s.items[4]!.at);
  // "in" edge: no earlier than the word's landing + entry, even though the section came in before
  assert.equal(sin('w0').t, r6(s.items[0]!.at + ENTRY));
  assert.ok(sin('w0').t > s.timing.in);
  // the start beats count from the landing, not from `in`
  assert.equal(sin('w2').t, r6(r6(s.items[2]!.at + ENTRY) + 0.5 * BEAT));
  assert.equal(sin('w2').until, r6(sin('w2').t + 2 * BEAT));
  // the default hold edge already comes after every landing: unchanged
  assert.equal(sin('wh').t, s.timing.holdStart);
  // the same sketch placed automatically starts at the section's `in`
  const auto = sheetOf(withSketches(40, { 1: [circle('w0', { start: { edge: 'in' } })] }));
  assert.equal(auto.cues.find((c) => c.type === 'sketch-in')!.t, auto.sections[1]!.timing.in);
});

test('word sketch timing: the budget rule counts from the landing (out ≥ landed + beats + drawBeats + 1 beat)', () => {
  const base = sheetOf(withSketches(32, {}));
  const tag = base.sections[1]!;
  // the last word lands at lastLand; drawing 3 beats from there plus one beat needs more than the tagline's hold
  assert.ok(tag.timing.out < r6(tag.items[4]!.at + ENTRY + 4 * BEAT), 'tagline must start out too short for the test');
  const sheet = sheetOf(withSketches(32, { 1: [onWord('w', 4, { start: { edge: 'in' }, look: { drawBeats: 3 } })] }));
  const s = sheet.sections[1]!;
  const sin = sheet.cues.find((c) => c.type === 'sketch-in')!;
  assert.equal(sin.t, r6(s.items[4]!.at + ENTRY));
  assert.ok(s.timing.out >= sin.until! + BEAT - 1e-9, `out ${s.timing.out} < drawEnd ${sin.until} + beat`);
  assert.equal(sheet.duration, 32);
  // a word whose landing leaves enough room changes no time at all
  const early = sheetOf(withSketches(40, { 1: [onWord('w', 0, { start: { edge: 'in' }, look: { drawBeats: 1 } })] }));
  assert.deepEqual(early.sections, sheetOf(withSketches(40, {})).sections);
});

test('word sketch timing: it leaves with its word, at the next section\u2019s entry (riding the move), exit before that', () => {
  const sheet = sheetOf(withSketches(40, { 1: [onWord('w', 2, { look: { exit: 'fade' } })], 2: [circle('a', { look: { exit: 'fade' } })] }));
  const [tag, body] = [sheet.sections[1]!, sheet.sections[2]!];
  const out = (id: string) => sheet.cues.find((c) => c.type === 'sketch-out' && c.sketch === id)!;
  assert.ok(body.timing.in > tag.timing.out, 'kinetic-quote moves the camera between sections');
  assert.deepEqual([out('w').t, out('w').until], [r6(body.timing.in - 0.3), body.timing.in]);
  // an automatic sketch still leaves with its section's `out`
  assert.deepEqual([out('a').t, out('a').until], [r6(body.timing.out - 0.3), body.timing.out]);
});
