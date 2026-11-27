import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JobSpec, retargetWordSketches, sectionItems, type JobSpecInput } from './index.ts';

// the P5 review's repros (out/sketch/P5-review/repro-text-edit.ts) on examples/sketch/he.json
const example: JobSpecInput = JSON.parse(readFileSync(new URL('../../../examples/sketch/he.json', import.meta.url), 'utf8'));
const BODY = example.sections.findIndex((s) => s.role === 'body');
const TEASER = example.sections.findIndex((s) => s.role === 'teaser');

/** The example with section `i` edited by `edit`, its word sketches retargeted as the studio does. */
function edited(i: number, edit: (s: Record<string, unknown>) => void) {
  const before = example.sections[i]!;
  const after = { ...before } as Record<string, unknown>;
  edit(after);
  const r = retargetWordSketches(before, after as typeof before);
  const raw = structuredClone(example);
  raw.sections[i] = r.section;
  const parsed = JobSpec.safeParse(raw);
  assert.ok(parsed.success, parsed.success ? '' : parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
  const s = parsed.data.sections[i]!;
  const items = sectionItems(s, parsed.data);
  const on = Object.fromEntries((s.role === 'endcard' ? [] : (s.sketches ?? [])).flatMap((k) => (k.place.mode === 'word' ? [[k.id, items[k.place.item]!.text]] : [])));
  return { on, dropped: r.dropped, words: r.words, same: r.section === after };
}

test('word sketches follow their word: insert and delete before it, big-text edits with small-line sketches', () => {
  assert.deepEqual(edited(BODY, (s) => (s.text = 'בואו חברים, נשב, נדבר ונשתה *קפה*')).on, { 'circle-word': 'קפה' });
  assert.deepEqual(edited(BODY, (s) => (s.text = 'בואו נדבר ונשתה *קפה*')).on, { 'circle-word': 'קפה' });
  // a big word added before the small line shifts every small-line index
  const more = edited(TEASER, (s) => (s.text = 'יהיו המון *הפתעות*'));
  assert.deepEqual(more.on, { 'underline-sub': 'שווים', 'arrow-sub': 'ופרסים' });
  assert.deepEqual(more.dropped, []);
  // an edit after the word moves nothing, and an edit without word sketches returns the section as it is
  assert.equal(edited(BODY, (s) => (s.text = 'בואו, נשב, נדבר ונשתה *קפה* היום')).on['circle-word'], 'קפה');
  assert.equal(edited(TEASER, (s) => (s.text = 'יהיו *הפתעות*!')).dropped.length, 0);
});

test('word sketches are dropped with their word: deleting it, removing the small line, losing its emphasis', () => {
  const gone = edited(BODY, (s) => (s.text = 'בואו, נשב, נדבר ונשתה תה'));
  assert.deepEqual(gone.on, {});
  assert.deepEqual([gone.dropped, gone.words], [['circle-word'], ['קפה']]);
  const noSub = edited(TEASER, (s) => delete s.sub);
  assert.deepEqual(noSub.on, {});
  assert.deepEqual(noSub.dropped, ['underline-sub', 'arrow-sub']);
  // un-emphasising (a chip click, or Suggest rewriting the stars) drops the sketch of a word that had emphasis
  const plain = edited(BODY, (s) => (s.text = 'בואו, נשב, נדבר ונשתה קפה'));
  assert.deepEqual([plain.on, plain.dropped], [{}, ['circle-word']]);
  // a sketch on a word that never had emphasis stays (the example's arrow sits on the unemphasised "ופרסים")
  assert.equal(edited(TEASER, (s) => (s.sub = 'ופרסים שווים')).on['arrow-sub'], 'ופרסים');
});

test('a word edited in place keeps its sketch: "!" added, a typo fixed, a letter backspaced, niqqud added (P5 review r2)', () => {
  for (const [label, text, word] of [
    ['"!" added', 'בואו, נשב, נדבר ונשתה *קפה!*', 'קפה!'],
    ['typo fixed', 'בואו, נשב, נדבר ונשתה *כפה*', 'כפה'],
    ['letter backspaced', 'בואו, נשב, נדבר ונשתה *קפ*', 'קפ'],
    ['niqqud added', 'בואו, נשב, נדבר ונשתה *קָפֶה*', 'קָפֶה'],
  ] as const) {
    const r = edited(BODY, (s) => (s.text = text));
    assert.deepEqual([r.on, r.dropped], [{ 'circle-word': word.normalize('NFC') }, []], label);
  }
  // edited in place but no longer emphasised: dropped as before
  assert.deepEqual(edited(BODY, (s) => (s.text = 'בואו, נשב, נדבר ונשתה קפה!')).dropped, ['circle-word']);
  // two words replaced by one is not "the same word": dropped
  assert.deepEqual(edited(BODY, (s) => (s.text = 'בואו, נשב, נדבר *תה*')).dropped, ['circle-word']);
});
