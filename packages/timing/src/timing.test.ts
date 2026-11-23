import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JobSpec } from '@reel/core';
import { recipe } from '@reel/styles';
import { buildCueSheet, TimingError } from './index.ts';

const example = JSON.parse(readFileSync(new URL('../../../examples/dilemma.json', import.meta.url), 'utf8'));
const choreography = recipe('kinetic-quote').choreography;
const sheet = buildCueSheet({ spec: JobSpec.parse(example), choreography, bpm: 100, fps: 30 });
const H = 0.3; // half-beat at 100 bpm

test('every landing sits on the half-beat grid and inside its section window', () => {
  for (const s of sheet.sections) {
    for (const it of s.items) {
      const h = (it.at - 0.5) / H;
      assert.ok(Math.abs(h - Math.round(h)) < 1e-6, `${it.text} at ${it.at} is off-grid`);
      assert.ok(it.at >= s.timing.in && it.at <= s.timing.out, `${it.text} outside ${s.id}`);
    }
  }
});

test('sections are ordered, non-overlapping, and the end card holds ≥ endHold to the end', () => {
  const ss = sheet.sections;
  for (let i = 1; i < ss.length; i++) assert.ok(ss[i]!.timing.in >= ss[i - 1]!.timing.out);
  const end = ss.at(-1)!;
  assert.equal(end.role, 'endcard');
  assert.equal(end.timing.out, 26);
  const outro = sheet.cues.find((c) => c.type === 'outro')!;
  assert.ok(26 - outro.t >= choreography.endHold - 1e-9);
  assert.equal(sheet.frames, 780);
});

test('content items come from the spec: derived weekday, emphasis, LTR numbers, logos', () => {
  const dt = sheet.sections.find((s) => s.role === 'datetime')!;
  assert.deepEqual(
    dt.items.map((i) => [i.text, i.ltr]),
    [['יום שלישי', false], ['01.12', true], ['19:30', true]],
  );
  const tag = sheet.sections.find((s) => s.role === 'tagline')!;
  assert.deepEqual(tag.items.filter((i) => i.emphasis).map((i) => i.text), ['מעניינים', 'וחמים']);
  const loc = sheet.sections.find((s) => s.role === 'location')!;
  assert.deepEqual(loc.items.map((i) => i.text), ['בית', 'החאן,', 'קרית שמונה']);
  const end = sheet.sections.at(-1)!;
  assert.deepEqual(end.items.map((i) => i.kind), ['word', 'word', 'word', 'logos']);
});

test('a short word takes the off-beat and the next word returns to the beat', () => {
  const tag = sheet.sections.find((s) => s.role === 'tagline')!.items;
  const [a, b, c] = tag.map((i) => i.at);
  assert.ok(Math.abs(b! - a! - H) < 1e-9 && Math.abs(c! - a! - 2 * H) < 1e-9);
});

test('too much text for the duration is a TimingError naming the needed length', () => {
  const long = { ...example, duration: 12 };
  assert.throws(
    () => buildCueSheet({ spec: JobSpec.parse(long), choreography, bpm: 100, fps: 30 }),
    (e: unknown) => e instanceof TimingError && e.needed > 12 && e.needed < 26,
  );
});

test('changing only the date leaves every time unchanged', () => {
  const moved = structuredClone(example);
  moved.sections[4].date = '2026-12-03';
  const other = buildCueSheet({ spec: JobSpec.parse(moved), choreography, bpm: 100, fps: 30 });
  assert.deepEqual(other.cues, sheet.cues);
  assert.equal(other.sections[4]!.items[0]!.text, 'יום חמישי');
});
