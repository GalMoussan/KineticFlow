import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JobSpec } from '@reel/core';
import { recipe } from '@reel/styles';
import { buildCueSheet } from '@reel/timing';
import { MUSIC_PRESETS, limit, musicScore, renderMusic, synthesize, ScoreError } from './index.ts';

const spec = JobSpec.parse(JSON.parse(readFileSync(new URL('../../../examples/dilemma.json', import.meta.url), 'utf8')));
const sheet = buildCueSheet({ spec, choreography: recipe('kinetic-quote').choreography, bpm: 100, fps: 30 });
const music = { preset: 'lofi-jazz', bpm: 100, seed: 1101 };
const doc = musicScore(sheet, music);
const first = renderMusic(sheet, music);

test('same input gives a byte-identical WAV', () => {
  const second = renderMusic(sheet, music);
  assert.equal(Buffer.compare(first.wav, second.wav), 0);
  const other = renderMusic(sheet, { ...music, seed: 7 });
  assert.notEqual(Buffer.compare(first.wav, other.wav), 0, 'seed changes the noise');
});

test('WAV holds exactly 26·48000 stereo 16-bit frames with a valid header', () => {
  const v = new DataView(first.wav.buffer, first.wav.byteOffset, first.wav.byteLength);
  const tag = (o: number) => String.fromCharCode(...first.wav.subarray(o, o + 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(v.getUint32(4, true), first.wav.byteLength - 8);
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(12), 'fmt ');
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 48000 * 4);
  assert.equal(v.getUint16(32, true), 4);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(tag(36), 'data');
  assert.equal(v.getUint32(40, true), 26 * 48000 * 4);
  assert.equal(first.wav.byteLength, 44 + 26 * 48000 * 4);
  assert.equal(first.samples, 26 * 48000);
  assert.equal(first.sampleRate, 48000);
});

test('every land cue has a bell pluck at its exact time; emphasis lands get the second pluck', () => {
  const bells = doc.notes.filter((n) => n.waveform === 'bell');
  const emph = new Set(sheet.cues.filter((c) => c.type === 'emphasis').map((c) => `${c.section}#${c.unit}`));
  const lands = sheet.cues.filter((c) => c.type === 'land');
  assert.ok(lands.length > 20);
  for (const c of lands) {
    assert.ok(bells.some((n) => n.at === c.t && n.gain === 0.075), `pluck at ${c.t}`);
    const second = bells.some((n) => Math.abs(n.at - (c.t + 0.03)) < 1e-9 && n.gain === 0.05);
    assert.equal(second, emph.has(`${c.section}#${c.unit}`), `second pluck at ${c.t}`);
  }
});

test('no note extends past the duration or violates attack + release ≤ duration', () => {
  for (const n of doc.notes) {
    assert.ok(n.at >= 0 && n.at + n.duration <= doc.duration + 1e-9, `note at ${n.at} + ${n.duration}`);
    assert.ok((n.attack ?? 0) + (n.release ?? 0) <= n.duration, `envelope of note at ${n.at}`);
  }
  assert.equal(first.notes, doc.notes.length);
});

test('peak ≤ 0.95 after normalisation', () => {
  assert.ok(first.peak > 0.5 && first.peak <= 0.95, `peak ${first.peak}`);
  const v = new DataView(first.wav.buffer, first.wav.byteOffset + 44);
  let max = 0;
  for (let o = 0; o < v.byteLength; o += 2) max = Math.max(max, Math.abs(v.getInt16(o, true)));
  assert.ok(max <= Math.round(0.95 * 32767), `pcm peak ${max}`);
});

test('unknown preset and invalid documents are rejected', () => {
  assert.deepEqual(MUSIC_PRESETS, ['lofi-jazz']);
  assert.throws(() => renderMusic(sheet, { ...music, preset: 'polka' }), /lofi-jazz/);
  assert.throws(() => synthesize({ duration: 1, notes: [{ at: 0.9, duration: 0.2 }] }), ScoreError);
  assert.throws(() => synthesize({ duration: 1, notes: [{ at: 0, duration: 0.1, attack: 0.06, release: 0.05 }] }), ScoreError);
});

test('bus limiter keeps every sample under ceiling · input peak', () => {
  const { mix } = synthesize(doc);
  let before = 0;
  for (const v of mix) before = Math.max(before, Math.abs(v));
  limit(mix, 48000, { ceiling: 0.6, lookahead: 0.005, release: 0.15 });
  let after = 0;
  for (const v of mix) after = Math.max(after, Math.abs(v));
  assert.ok(after <= before * 0.6 + 1e-12, `${after} > ${before * 0.6}`);
  assert.ok(after > before * 0.55, 'limiter should not over-attenuate');
});
