import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobSpec, type JobSpecInput } from './spec.ts';
import { retargetSketchUntil } from './until.ts';

type S = JobSpecInput['sections'][number];
const star = (until?: string): S => ({ role: 'teaser', text: 'יהיו *הפתעות*', sketches: [{ id: 'star', source: { kind: 'preset', preset: 'star' }, ...(until ? { until } : {}) }] });
const base = (): S[] => [
  { role: 'title', text: 'כותרת' },
  { role: 'tagline', text: 'שורה' },
  star('dt'),
  { role: 'body', text: 'גוף' },
  { id: 'dt', role: 'datetime', date: '2026-12-01' },
  { role: 'cta', text: 'בואו' },
  { role: 'endcard', logos: [] },
];
const untilOf = (ss: readonly S[]) => {
  const s = ss.find((x) => x.role === 'teaser');
  return s && s.role !== 'endcard' ? s.sketches?.[0]?.until : undefined;
};
const spec = (sections: S[]): JobSpecInput => ({
  id: 'u', language: 'he', contentType: 'event', sections, style: 'kinetic-quote', palette: 'flamingo-cafe',
  fonts: { display: 'rubik' }, music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1 }, duration: 40, formats: ['9:16'],
});
const valid = (ss: S[]) => JobSpec.safeParse(spec(ss)).success;

test('until: insert and move keep the same target; untouched objects are returned as is', () => {
  const b = base();
  const ins = [b[0]!, { role: 'body', text: 'חדש' } as S, ...b.slice(1)];
  const r = retargetSketchUntil(b, ins);
  assert.equal(untilOf(r), 'dt');
  assert.ok(r.every((x, i) => x === ins[i]));
  assert.ok(valid(r));
  const mv = [b[0]!, b[1]!, b[2]!, b[4]!, b[3]!, b[5]!, b[6]!]; // datetime moved up, still later than the teaser
  assert.equal(untilOf(retargetSketchUntil(b, mv)), 'dt');
});

test('until: deleting the target clamps to the nearest later section before it, pinning its id', () => {
  const b = base();
  const del = b.filter((_, i) => i !== 4);
  const r = retargetSketchUntil(b, del);
  assert.equal(untilOf(r), 'body-3');
  assert.equal(r[3]!.id, 'body-3');
  assert.ok(valid(r));
});

test('until: target moved before the sketch → clamped; nothing later → until dropped', () => {
  const b = base();
  const mv = [b[0]!, b[4]!, b[1]!, b[2]!, b[3]!, b[5]!, b[6]!];
  const r = retargetSketchUntil(b, mv);
  assert.equal(untilOf(r), 'body-3');
  assert.ok(valid(r));
  // the teaser moved to the end: no later section → drop
  const last = [b[0]!, b[1]!, b[3]!, b[4]!, b[5]!, b[6]!, b[2]!];
  const r2 = retargetSketchUntil(b, last);
  assert.equal(untilOf(r2), undefined);
});

test('until: deleting an unrelated earlier section never retargets silently (positional ids shift)', () => {
  // the target has no explicit id yet (drafts from before this rule): the helper pins its old id
  const b = base().map((x) => (x.id === 'dt' ? { role: 'datetime', date: '2026-12-01' } as S : x));
  b[2] = star('datetime-4');
  b.splice(5, 0, { role: 'datetime', date: '2026-12-02' });
  const del = b.filter((_, i) => i !== 1); // the second datetime would now default to "datetime-4"
  const r = retargetSketchUntil(b, del);
  const t = r.findIndex((x) => x === b[4] || (x.role === 'datetime' && 'date' in x && x.date === '2026-12-01'));
  assert.equal(untilOf(r), r[t]!.id);
  assert.notEqual(r[t]!.id, 'datetime-4', 'a pinned id must not collide with a positional default');
  assert.ok(valid(r));
});

test('until: an explicit target id never collides with another section’s shifted default (review until-demo case)', () => {
  // teaser → until the explicit "datetime-4"; a second datetime after it; delete an earlier section: the second
  // datetime's positional default becomes "datetime-4" too
  const b: S[] = [
    { role: 'title', text: 'כותרת' },
    { role: 'tagline', text: 'שורה' },
    { role: 'body', text: 'גוף' },
    star('datetime-4'),
    { id: 'datetime-4', role: 'datetime', date: '2026-12-01' },
    { role: 'datetime', date: '2026-12-02' },
    { role: 'endcard', logos: [] },
  ];
  const del = b.filter((_, i) => i !== 1);
  assert.equal(valid(del), false, 'without the helper the edit is invalid');
  const r = retargetSketchUntil(b, del);
  assert.ok(valid(r));
  assert.equal(untilOf(r), 'datetime-4');
  assert.equal(r[3]!.id, 'datetime-4');
  assert.equal(r[4]!.id, 'datetime-4-2');
});
