/**
 * Listening check for own-track sync (M3): `<job>-<format>-clicks.mp4` = the delivered video with a click on every
 * `land` cue, plus an independent measurement: Beat This! re-run on the delivered MP4's audio (after loudnorm and AAC),
 * and each landing's offset to the nearest detected beat or half-beat.
 *
 *   node packages/render/dev/click-overlay.ts out/<job-id> [9:16]
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatSlug, type FormatId } from '@reel/core';
import { MODEL_PATH, SIDECAR_DIR, type TrackAnalysis } from '../src/analysis.ts';
import type { Receipt } from '../src/index.ts';
import type { GateResult } from '../src/qa.ts';
import { exec, ffmpeg } from '../src/util.ts';

const [dir, format = '9:16'] = process.argv.slice(2);
if (!dir) throw new Error('usage: click-overlay.ts out/<job-id> [format]');
const receipt = JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8')) as Receipt;
const sync = receipt.qa.find((g: GateResult) => g.gate === 'audio-sync');
if (!sync) throw new Error(`${dir}: no audio-sync gate (not a track job)`);
// written by gateAudioSync in this repo's own render: its `data` shape is known
const syncData = sync.data as { offsets: { t: number; section: string; unit: number }[] };
const lands = syncData.offsets;
const video = receipt.formats[format as FormatId]!.outputs.video.path;

// clicks: 2 kHz, 12 ms exponential decay, 48 kHz mono 16-bit
const SR = 48_000;
const n = Math.round(receipt.duration * SR);
const pcm = new Int16Array(n);
for (const { t } of lands) {
  const s0 = Math.round(t * SR);
  for (let i = 0; i < 0.03 * SR && s0 + i < n; i++) {
    pcm[s0 + i] = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 2000 * i) / SR) * Math.exp(-i / (0.012 * SR)));
  }
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + n * 2, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(n * 2, 40);
const clicks = join(dir, 'clicks.tmp.wav');
await writeFile(clicks, Buffer.concat([header, Buffer.from(pcm.buffer)]));
const out = join(dir, `${receipt.job}-${formatSlug(format as FormatId)}-clicks.mp4`);
await ffmpeg([
  '-y', '-v', 'error', '-i', video, '-i', clicks,
  '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0[a]',
  '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out,
]);
await rm(clicks);
console.log(`click overlay: ${out} (${lands.length} clicks)`);
console.log(`audio-sync gate (cue sheet vs the sidecar's beats of the source file): ${sync.detail}`);

// independent: beats of the delivered audio
const json = join(dir, 'delivered-beats.tmp.json');
await exec(join(SIDECAR_DIR, '.venv/bin/python'), [join(SIDECAR_DIR, 'analyze.py'), video, '--model', MODEL_PATH, '-o', json]);
const delivered = JSON.parse(await readFile(json, 'utf8')) as TrackAnalysis;
await rm(json);
const b = delivered.beats;
const slots = [...b, ...b.slice(1).map((x, i) => (b[i]! + x) / 2)];
const offs = lands.map(({ t }) => {
  const near = slots.reduce((best, s) => (Math.abs(s - t) < Math.abs(best - t) ? s : best), Infinity);
  return (t - near) * 1000;
});
const abs = offs.map(Math.abs);
console.log(
  `delivered-audio beats (Beat This! on ${video.split('/').pop()}): ${b.length} beats, ${delivered.bpm} bpm · ` +
    `landing − beat: max |${Math.max(...abs).toFixed(1)}| ms, mean |${(abs.reduce((x, y) => x + y, 0) / abs.length).toFixed(1)}| ms, ` +
    `signed mean ${(offs.reduce((x, y) => x + y, 0) / offs.length).toFixed(1)} ms · within 1 frame (${(1000 / 30).toFixed(1)} ms): ` +
    `${abs.filter((x) => x <= 1000 / 30 + 1e-6).length}/${abs.length}`,
);
