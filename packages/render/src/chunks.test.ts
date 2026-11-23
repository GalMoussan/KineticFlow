import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format } from '@reel/core';
import { chunkKey, chunkWindow, planChunks, type KeyInput } from './chunks.ts';
import { captureTimes, resolveQuality } from './encode.ts';

test('chunk plan: fixed 10 s chunks at the output fps, last one shorter', () => {
  assert.deepEqual(planChunks(780, 30), [
    { index: 0, f0: 0, f1: 300 },
    { index: 1, f0: 300, f1: 600 },
    { index: 2, f0: 600, f1: 780 },
  ]);
  assert.deepEqual(planChunks(1560, 60).map((c) => [c.f0, c.f1]), [[0, 600], [600, 1200], [1200, 1560]]);
  assert.deepEqual(planChunks(600, 30).map((c) => [c.f0, c.f1]), [[0, 300], [300, 600]]);
  assert.deepEqual(planChunks(180, 30), [{ index: 0, f0: 0, f1: 180 }]);
});

test('chunk plan covers every frame exactly once', () => {
  for (const [frames, fps] of [[780, 30], [901, 30], [1801, 60], [1, 30]] as const) {
    const chunks = planChunks(frames, fps);
    assert.equal(chunks[0]!.f0, 0);
    assert.equal(chunks.at(-1)!.f1, frames);
    chunks.slice(1).forEach((c, i) => assert.equal(c.f0, chunks[i]!.f1));
  }
});

test('chunk window starts at the first (sub-)frame capture', () => {
  const standard = resolveQuality('standard');
  assert.deepEqual(chunkWindow({ index: 1, f0: 300, f1: 600 }, standard), [10, 20]);
  const final = resolveQuality('final');
  const [t0, t1] = chunkWindow({ index: 1, f0: 600, f1: 1200 }, final);
  assert.ok(t0 < 10 && t0 > 10 - 1 / 60);
  assert.equal(t1, 20);
  assert.equal(captureTimes(600, 1200, final).length, 600 * 6);
});

const base: KeyInput = {
  bundleHash: 'b'.repeat(64),
  chromium: '159.0.8154.6',
  format: format('9:16'),
  quality: resolveQuality('standard'),
  chunk: { index: 1, f0: 300, f1: 600 },
  fingerprint: { sections: [{ id: 'datetime-4', items: ['יום שלישי', '01.12', '19:30'] }] },
  look: { palette: { bg: '#F5EBDD', text: '#1B2A4A', accents: ['#F2849E'] }, fonts: {} as KeyInput['look']['fonts'], params: { drift: 0.04 } },
};

test('cache key is stable for equal inputs, independent of object key order', () => {
  const reordered: KeyInput = {
    ...base,
    fingerprint: { sections: [{ items: ['יום שלישי', '01.12', '19:30'], id: 'datetime-4' }] },
  };
  assert.equal(chunkKey(base), chunkKey(structuredClone(base)));
  assert.equal(chunkKey(base), chunkKey(reordered));
  assert.match(chunkKey(base), /^[0-9a-f]{64}$/);
});

test('cache key changes with the fingerprint and every other input', () => {
  const k = chunkKey(base);
  const variants: Partial<KeyInput>[] = [
    { fingerprint: { sections: [{ id: 'datetime-4', items: ['יום חמישי', '03.12', '19:30'] }] } },
    { bundleHash: 'c'.repeat(64) },
    { chromium: '160.0.0.0' },
    { format: format('1:1') },
    { quality: resolveQuality('final') },
    { chunk: { index: 1, f0: 300, f1: 599 } },
  ];
  for (const v of variants) assert.notEqual(chunkKey({ ...base, ...v }), k, JSON.stringify(Object.keys(v)));
});
