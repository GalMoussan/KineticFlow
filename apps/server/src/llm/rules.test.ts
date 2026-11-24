import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JobSpec, plainText } from '@reel/core';
import { RECIPES } from '@reel/styles';
import { repairSection } from './index.ts';
import { detectLanguage, emphasizeLine, findDateTime, rankRules, splitRules } from './rules.ts';

const today = new Date('2026-11-23T10:00:00Z');

const HE = `קפה דילמה וג׳אם ☕️
הנושאים הכי מעניינים וחמים היום!
בואו, נשב, נדבר ונשתה קפה
יהיו הפתעות
יום שלישי 1.12 בשעה 19:30
בבית החאן, קרית שמונה
בואו לדבר!`;

const EN = `Open Mic Night
Bring your guitar, your poems and your best jokes.
What's on:
- Live music
- Stand-up
- Free pizza
Friday, December 4th at 8pm
@ The Khan Club, Tel Aviv
120+ performers so far
Join us!`;

/** The split dropped into a full spec must parse. */
function asSpec(sections: unknown[], language: 'he' | 'en') {
  return JobSpec.parse({
    id: 'split-test',
    language,
    contentType: 'event',
    sections,
    style: 'kinetic-quote',
    palette: 'flamingo-cafe',
    fonts: { display: 'rubik' },
    music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1 },
    duration: 30,
    formats: ['9:16'],
  });
}

test('Hebrew event text → valid spec sections', () => {
  const r = splitRules(HE, { today, logos: ['kiryat-shmona', 'ayalim'] });
  assert.equal(r.language, 'he');
  assert.equal(r.contentType, 'event');
  assert.equal(r.title, 'קפה דילמה וג׳אם');
  assert.ok(r.notes.some((n) => n.includes('emoji')));
  const spec = asSpec(r.sections, 'he');
  const roles = spec.sections.map((s) => s.role);
  assert.equal(roles[0], 'title');
  assert.equal(roles.at(-1), 'endcard');
  assert.equal(roles[1], 'tagline', 'the line after the title is the tagline even with "!"');
  const dt = spec.sections.find((s) => s.role === 'datetime');
  assert.deepEqual(dt && { date: dt.date, time: dt.time }, { date: '2026-12-01', time: '19:30' });
  const loc = spec.sections.find((s) => s.role === 'location');
  assert.deepEqual(loc && { place: loc.place, city: loc.city }, { place: 'בית החאן', city: 'קרית שמונה' });
  assert.equal(spec.sections.filter((s) => s.role === 'cta').length, 2);
  const end = spec.sections.at(-1)!;
  assert.deepEqual(end.role === 'endcard' && end.logos, ['kiryat-shmona', 'ayalim']);
  for (const s of spec.sections) {
    if ('text' in s && s.role !== 'endcard' && s.text) {
      const marks = (s.text.match(/\*/g) ?? []).length / 2;
      assert.ok(marks >= 1 && marks <= 2, `${s.role} "${s.text}" has 1–2 emphases`);
    }
  }
});

test('English event text → valid spec sections', () => {
  const r = splitRules(EN, { today });
  assert.equal(r.language, 'en');
  const spec = asSpec(r.sections, 'en');
  const by = (role: string) => spec.sections.find((s) => s.role === role);
  const list = by('list');
  assert.deepEqual(list?.role === 'list' && { title: list.title, items: list.items }, { title: "What's on", items: ['Live music', 'Stand-up', 'Free pizza'] });
  const dt = by('datetime');
  assert.deepEqual(dt?.role === 'datetime' && [dt.date, dt.time], ['2026-12-04', '20:00']);
  const loc = by('location');
  assert.deepEqual(loc?.role === 'location' && [loc.place, loc.city], ['The Khan Club', 'Tel Aviv']);
  const stat = by('stat');
  assert.deepEqual(stat?.role === 'stat' && [stat.value, stat.suffix, stat.label], [120, '+', 'performers so far']);
  assert.equal(spec.sections.at(-2)?.role, 'cta');
  assert.deepEqual(spec.sections.at(-1), { role: 'endcard', logos: [], id: `endcard-${spec.sections.length - 1}` });
});

test('dates and times', () => {
  const d = (s: string) => findDateTime(s, today);
  assert.equal(d('1.12').date, '2026-12-01');
  assert.equal(d('01/03').date, '2027-03-01', 'past dates without a year roll to next year');
  assert.equal(d('5.1.2027').date, '2027-01-05');
  assert.equal(d('2026-12-24').date, '2026-12-24');
  assert.equal(d('3 בדצמבר').date, '2026-12-03');
  assert.equal(d('ב-15 בינואר 2027').date, '2027-01-15');
  assert.equal(d('Dec 31').date, '2026-12-31');
  assert.equal(d('31.2').date, undefined, 'invalid calendar date');
  assert.equal(d('בשעה 9:05').time, '09:05');
  assert.equal(d('at 7:30 pm').time, '19:30');
  assert.equal(d('12am').time, '00:00');
  assert.deepEqual(d('just words'), { rest: 'just words' });
});

test('language, emphasis and a time without a date', () => {
  assert.equal(detectLanguage('שלום עולם, hi'), 'he');
  assert.equal(detectLanguage('hello עולם'), 'en');
  assert.equal(emphasizeLine('the most wonderful party'), 'the most *wonderful* party');
  assert.equal(emphasizeLine('already *done* here'), 'already *done* here');
  assert.equal((emphasizeLine('one two three four five sixsix').match(/\*/g) ?? []).length, 4);
  const r = splitRules('Title\nStarts at 19:00', { today });
  assert.ok(r.notes.some((n) => n.includes('no date')));
  assert.equal(plainText(String(r.sections[0]!.text)), 'Title');
  assert.equal(r.sections.at(-1)!.role, 'endcard');
});

test('list content type turns plain lines into list items', () => {
  const r = splitRules('Top picks\nCoffee\nTea\nCake', { today, contentType: 'list' });
  assert.deepEqual(r.sections[1], { role: 'list', items: ['Coffee', 'Tea', 'Cake'] });
});

test('repairSection normalises LLM output and drops invalid sections', () => {
  assert.deepEqual(repairSection({ role: 'datetime', date: '1.12', time: '19.30', text: 'x' }, today), { role: 'datetime', date: '2026-12-01', time: '19:30' });
  assert.deepEqual(repairSection({ role: 'stat', value: '120', suffix: '+', label: 'people' }, today), { role: 'stat', value: 120, suffix: '+', label: 'people' });
  assert.deepEqual(repairSection({ role: 'tagline', text: 'a lovely evening' }, today), { role: 'tagline', text: 'a lovely *evening*' });
  assert.equal(repairSection({ role: 'tagline', text: '' }, today), null);
  assert.equal(repairSection({ role: 'banner', text: 'x' }, today), null);
  assert.equal(repairSection({ role: 'endcard', logos: [] }, today), null, 'the end card is added by the server');
});

test('rankRules: keyword and energy matching', () => {
  assert.equal(rankRules('wild neon party night')[0]!.style, 'neon-psychedelic');
  assert.equal(rankRules('ערב קפה רגוע וחמים עם סיפורים')[0]!.style, 'kinetic-quote');
  assert.equal(rankRules('techno DJ club night, bass')[0]!.style, 'bass-pulse');
  assert.equal(rankRules('clean professional conference announcement')[0]!.style, 'swiss-title-reveal');
  const all = rankRules('');
  assert.equal(all.length, Object.keys(RECIPES).length);
  assert.equal(rankRules('airport departure board for our travel club')[0]!.style, 'split-flap');
  assert.equal(rankRules('trivia night: 5 questions')[0]!.style, 'card-deck-3d');
  assert.ok(all.every((x) => x.score >= 0 && x.score <= 1 && x.reason));
});
