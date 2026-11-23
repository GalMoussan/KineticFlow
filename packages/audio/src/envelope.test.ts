import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS } from '@reel/core';
import { computeEnvelopes } from './envelope.ts';

const SR = 48000;
const FPS = 30;

/** Stereo of `seconds` with a 4-on-the-floor-ish set of kicks (decaying 55 Hz + 120 Hz body) at `kicks`. */
function kicks(seconds: number, at: number[], extra?: (t: number) => number) {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = extra?.(t) ?? 0;
    for (const k of at) {
      const a = t - k;
      if (a >= 0 && a < 0.4) v += Math.exp(-a * 12) * (0.8 * Math.sin(2 * Math.PI * 55 * a) + 0.4 * Math.sin(2 * Math.PI * 120 * a));
    }
    l[i] = v;
  }
  return { l, r: l.slice(), sampleRate: SR };
}

test('silence gives 0 in every band and frame', () => {
  const x = { l: new Float32Array(SR * 2), r: new Float32Array(SR * 2), sampleRate: SR };
  const e = computeEnvelopes(x, FPS, 60);
  for (const b of BANDS) {
    assert.equal(e[b].length, 60);
    assert.ok(e[b].every((v) => v === 0), b);
  }
});

test('a kick at t rises in the frame containing t, never earlier', () => {
  // kicks in the middle of frames 30 and 75 (so the Hann window has weight on them inside their own frame)
  const at = [30.5 / FPS, 75.5 / FPS];
  const e = computeEnvelopes(kicks(4, at), FPS, 120);
  for (const t of at) {
    const f = Math.floor(t * FPS);
    for (let i = f - 5; i < f; i++) {
      // silence before the first kick; the second only decays before its own frame
      if (t === at[0]) assert.equal(e.bass[i], 0, `bass before the kick (frame ${i})`);
      else assert.ok(e.bass[i]! <= e.bass[i - 1]!, `bass does not rise before the kick (frame ${i})`);
    }
    assert.ok(e.bass[f]! > e.bass[f - 1]! + 0.2, `bass rises in frame ${f}: ${e.bass[f - 1]} → ${e.bass[f]}`);
    assert.ok(e.sub[f]! > e.sub[f - 1]!, `sub rises in frame ${f}`);
    assert.ok(e.onset[f]! > 0.5, `onset fires in frame ${f}: ${e.onset[f]}`);
    assert.ok(e.onset[f - 1]! < 0.05, `no onset before frame ${f}`);
  }
  // a kick has no high band to speak of
  assert.ok(Math.max(...e.high) < 0.4);
});

test('values are 0..1, rounded, and deterministic', () => {
  const x = kicks(3, [0.5, 1, 1.5, 2, 2.5], (t) => 0.05 * Math.sin(2 * Math.PI * 3000 * t));
  const a = computeEnvelopes(x, FPS, 90);
  const b = computeEnvelopes(x, FPS, 90);
  assert.deepEqual(a, b);
  for (const k of BANDS) for (const v of a[k]) assert.ok(v >= 0 && v <= 1 && Math.round(v * 1e4) / 1e4 === v);
  // the 3 kHz tone is constant: high stays high and flat while the bass pulses
  assert.ok(Math.min(...a.high.slice(10, 80)) > 0.8);
  assert.ok(Math.max(...a.bass) === 1 && Math.min(...a.bass.slice(10, 80)) < 0.6);
});

test('scale comes from the whole stem: asking for fewer frames does not change values', () => {
  const x = kicks(4, [0.5, 1.5, 2.5, 3.5]);
  const all = computeEnvelopes(x, FPS, 120);
  const part = computeEnvelopes(x, FPS, 40);
  for (const k of BANDS) assert.deepEqual(part[k], all[k].slice(0, 40));
  const more = computeEnvelopes(x, FPS, 150);
  assert.ok(more.bass.slice(120).every((v) => v === 0), 'frames past the stem are 0');
});

test('frame-end alignment holds at 60 fps too', () => {
  const t = 100.5 / 60;
  const e = computeEnvelopes(kicks(3, [t]), 60, 180);
  const f = Math.floor(t * 60);
  assert.equal(e.bass[f - 1], 0);
  assert.ok(e.bass[f]! > 0.3);
});
