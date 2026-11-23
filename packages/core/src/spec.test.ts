import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobSpec, type JobSpecInput } from './spec.ts';
import { parseEmphasis } from './emphasis.ts';
import { weekday, daysBetween } from './derive.ts';

const dilemma: JobSpecInput = {
  id: '2026-12-01-dilemma-cafe',
  language: 'he',
  contentType: 'event',
  sections: [
    { role: 'title', text: 'קפה דילמה וג׳אם' },
    { role: 'tagline', text: 'הנושאים הכי *מעניינים* ו*חמים* היום!', style: 'glitch-digital' },
    { role: 'datetime', date: '2026-12-01', time: '19:30' },
    { role: 'endcard', logos: ['kiryat-shmona', 'ayalim'] },
  ],
  style: { base: 'kinetic-quote', blendWith: { style: 'neon-psychedelic', mix: 0.3 }, traits: { reveal: 'typewriter' } },
  palette: 'flamingo-cafe',
  fonts: { display: 'rubik' },
  music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1101 },
  duration: 26,
  formats: ['9:16', '1:1'],
};

test('spec §13 example parses, gets section ids and defaults', () => {
  const spec = JobSpec.parse(dilemma);
  assert.deepEqual(
    spec.sections.map((s) => s.id),
    ['title-0', 'tagline-1', 'datetime-2', 'endcard-3'],
  );
  assert.equal(spec.quality, 'standard');
  assert.deepEqual(spec.outputs, { noMusic: true, keepChunks: false });
});

test('title and endcard are required; lyrics need an own track', () => {
  const r = JobSpec.safeParse({
    ...dilemma,
    sections: [{ role: 'lyric', lines: [{ text: 'שלום' }] }, { role: 'body', text: 'x' }],
  });
  assert.equal(r.success, false);
  const messages = r.error!.issues.map((i) => i.message).join('\n');
  assert.match(messages, /"title" section is required/);
  assert.match(messages, /"endcard" section is required/);
  assert.match(messages, /lyric sections need/);
});

test('unknown trait axis in an override is rejected', () => {
  const r = JobSpec.safeParse({ ...dilemma, style: { base: 'kinetic-quote', traits: { colour: 'neon' } } });
  assert.equal(r.success, false);
});

test('emphasis: markers, escapes, unmatched stars, NFC niqqud', () => {
  assert.deepEqual(parseEmphasis('הכי *מעניינים* ו*חמים*!'), [
    { text: 'הכי ', emphasis: false },
    { text: 'מעניינים', emphasis: true },
    { text: ' ו', emphasis: false },
    { text: 'חמים', emphasis: true },
    { text: '!', emphasis: false },
  ]);
  assert.deepEqual(parseEmphasis('5 \\* 3 = 15 *'), [{ text: '5 * 3 = 15 *', emphasis: false }]);
  assert.deepEqual(parseEmphasis('a ** b'), [{ text: 'a ** b', emphasis: false }]);
  // shin + qamats + shin dot (non-canonical order) normalises to the canonical NFC sequence
  assert.equal(parseEmphasis('*\u05E9\u05B8\u05C1*')[0]!.text, '\u05E9\u05B8\u05C1'.normalize('NFC'));
});

test('weekday is derived from the date, per locale', () => {
  assert.equal(weekday('2026-12-01', 'he'), 'יום שלישי');
  assert.equal(weekday('2026-12-01', 'en'), 'Tuesday');
  assert.equal(daysBetween('2026-11-23', '2026-12-01'), 8);
});
