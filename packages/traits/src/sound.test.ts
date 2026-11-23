import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CueSheet, SoundCue } from '@reel/core';
import { finishCues, MAX_PER_SECOND } from './lib/sound.ts';
import { level, reactive, slice } from './lib/reactive.ts';

const densest = (cues: SoundCue[]) => {
  let n = 0;
  for (const a of cues) n = Math.max(n, cues.filter((b) => b.t >= a.t && b.t < a.t + 1).length);
  return n;
};

test('finishCues: thins to ≤ 6 attacks per second, keeping accents over detail, independent of input order', () => {
  const raw: SoundCue[] = [
    ...Array.from({ length: 12 }, (_, i): SoundCue => ({ t: 1 + i * 0.05, kind: 'tick', weight: 0.4, pitch: i })),
    { t: 1.2, kind: 'impact', weight: 0.9 },
    { t: 1.1, kind: 'whoosh', weight: 0.5, until: 1.6 },
    { t: 1.3, kind: 'pop', weight: 0.5 },
  ];
  const out = finishCues(raw, 10);
  assert.ok(densest(out) <= MAX_PER_SECOND);
  for (const k of ['impact', 'whoosh', 'pop'] as const) assert.ok(out.some((c) => c.kind === k), k);
  assert.ok(out.every((c, i) => i === 0 || out[i - 1]!.t <= c.t), 'sorted by t');
  assert.deepEqual(finishCues([...raw].reverse(), 10), out);
});

test('finishCues: merges same-kind doubles, clamps and drops cues outside the video', () => {
  const out = finishCues(
    [
      { t: 2, kind: 'pop', weight: 0.3 },
      { t: 2.01, kind: 'pop', weight: 0.8 },
      { t: 2.01, kind: 'tick', weight: 0.3 },
      { t: -0.1, kind: 'pop', weight: 1 },
      { t: 9.5, kind: 'whoosh', weight: 2, until: 12, pan: -3 },
      { t: 10, kind: 'stinger', weight: 1 },
    ],
    10,
  );
  assert.deepEqual(out, [
    { t: 2, kind: 'pop', weight: 0.8 },
    { t: 2.01, kind: 'tick', weight: 0.3 },
    { t: 9.5, kind: 'whoosh', weight: 1, until: 10, pan: -1 },
  ]);
});

const sheet = (o: Partial<CueSheet>): CueSheet => ({
  duration: 4,
  fps: 30,
  frames: 120,
  bpm: 120,
  t0: 0.5,
  beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  downbeats: [0.5, 2.5],
  sections: [],
  cues: [],
  ...o,
});

test('reactive: envelopes get an instant attack and an exponential release', () => {
  const bass = new Array(120).fill(0);
  bass[30] = 1;
  const env = { sub: bass, bass, mid: bass, high: bass, onset: bass };
  const r = reactive(sheet({ envelopes: env }), 7.5);
  assert.equal(r.source, 'envelopes');
  assert.equal(level(r, 'bass', 29 / 30), 0, 'nothing before the peak frame');
  assert.equal(level(r, 'bass', 1), 1, 'attack within the frame (t = 30/30 lands on frame 30)');
  const k = Math.exp(-7.5 / 30);
  assert.ok(Math.abs(level(r, 'bass', 31 / 30) - k) < 1e-4);
  assert.ok(level(r, 'bass', 40 / 30) < level(r, 'bass', 35 / 30));
  const s = slice(r, ['bass'], 1, 1.1);
  assert.equal(s.from, 30);
  assert.equal(s.bass!.length, 4);
});

test('reactive: without envelopes the beat grid drives the bands (downbeats louder)', () => {
  const r = reactive(sheet({}), 7.5001);
  assert.equal(r.source, 'grid');
  assert.equal(level(r, 'bass', 0.4), 0, 'silent before the first beat');
  assert.equal(level(r, 'bass', 2.5), 1, 'full on a downbeat');
  assert.ok(level(r, 'bass', 1) < 1 && level(r, 'bass', 1) > 0.7, 'beats slightly weaker');
  assert.ok(level(r, 'high', 0.8) > 2 * level(r, 'high', 0.7), 'hats on the off-beat (0.75 s)');
});
