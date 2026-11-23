import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beatStrengths, decodeTrack, resolveTrack, videoGrid } from './track.ts';
import type { TrackAnalysis } from './analysis.ts';

const SR = 48_000;
const specDir = fileURLToPath(new URL('../../../examples/m3/', import.meta.url));
const mp3 = await resolveTrack(specDir, 'it-had-to-be-you');
const full = new Float32Array(
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', mp3, '-map', 'a:0', '-ac', '2', '-af', `aresample=${SR}`, '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], {
    maxBuffer: 1 << 28,
  }).buffer.slice(0),
);

test('resolveTrack finds <specDir>/assets/<id>.<ext> and names the paths it tried', async () => {
  assert.ok(mp3.endsWith('examples/m3/assets/it-had-to-be-you.mp3'));
  await assert.rejects(resolveTrack(specDir, 'nope'), /music track "nope" not found; looked for .*nope\.mp3.*nope\.ogg/);
});

test('the decoded window is bit-identical to the same samples of a full decode, at whole and fractional offsets', async () => {
  for (const offset of [0.5, 7.3, 12.345678]) {
    const samples = 3 * SR;
    const { audio, fromFile } = await decodeTrack(mp3, { offset, samples, fadeOut: 0, sampleRate: SR });
    assert.equal(fromFile, samples);
    assert.equal(audio.l.length, samples);
    const start = Math.round(offset * SR);
    for (let i = 0; i < samples; i++) {
      if (audio.l[i] !== full[(start + i) * 2] || audio.r[i] !== full[(start + i) * 2 + 1]) {
        assert.fail(`offset ${offset}: sample ${i} differs from the full decode`);
      }
    }
  }
});

test('decoding is deterministic, exactly `samples` long, faded to silence and padded past the end of the file', async () => {
  const hash = (x: Float32Array) => createHash('sha256').update(new Uint8Array(x.buffer)).digest('hex');
  const o = { offset: 30, samples: 12 * SR, fadeOut: 1.5, sampleRate: SR };
  const a = await decodeTrack(mp3, o);
  const b = await decodeTrack(mp3, o);
  assert.equal(hash(a.audio.l) + hash(a.audio.r), hash(b.audio.l) + hash(b.audio.r));
  assert.equal(a.audio.l.length, o.samples);
  // the 40 s file ends 10 s into the window: the rest is silence
  assert.equal(a.fromFile, 10 * SR);
  assert.equal(a.audio.l[o.samples - 1], 0);
  // the fade starts 1.5 s before the end: just before it the samples are untouched
  const i = o.samples - 1.5 * SR - 1;
  assert.equal(a.audio.l[i - 3 * SR], full[(30 * SR + i - 3 * SR) * 2]);
});

test('videoGrid moves file-time beats into video time and keeps a margin past the end', () => {
  const a = { beats: [0.9, 1.25, 1.6, 30.1, 31.5, 33], downbeats: [1.25, 31.5], meter_confidence: 0.75 } as TrackAnalysis;
  assert.deepEqual(videoGrid(a, 1, 30), { beats: [0.25, 0.6, 29.1, 30.5], downbeats: [0.25, 30.5], meterConfidence: 0.75 });
});

test('beatStrengths takes the onset max over the beat frame ± 1 and the median past the envelope', () => {
  const onset = [0, 0.1, 0.9, 0.2, 0, 0, 0.5, 0];
  assert.deepEqual(beatStrengths([0.1, 0.2, 0.55, 2], onset, 10), [0.9, 0.9, 0.5, 0.9]);
});
