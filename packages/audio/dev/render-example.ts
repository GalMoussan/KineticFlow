/**
 * Listening evidence: renders the lofi-jazz score for examples/dilemma.json to out/dev/lofi-example.{wav,mp3}
 * and prints render time, note count, peak and integrated loudness (ffmpeg ebur128).
 *   node packages/audio/dev/render-example.ts
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JobSpec } from '@reel/core';
import { recipe } from '@reel/styles';
import { buildCueSheet } from '@reel/timing';
import { renderMusic } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const spec = JobSpec.parse(JSON.parse(readFileSync(`${root}examples/dilemma.json`, 'utf8')));
if (spec.music.source !== 'preset') throw new Error('example spec must use a music preset');
const sheet = buildCueSheet({ spec, choreography: recipe(spec.style).choreography, bpm: spec.music.bpm, fps: 30 });

const start = performance.now();
const res = renderMusic(sheet, spec.music);
const ms = performance.now() - start;

const dir = `${root}out/dev`;
mkdirSync(dir, { recursive: true });
const wav = `${dir}/lofi-example.wav`;
const mp3 = `${dir}/lofi-example.mp3`;
writeFileSync(wav, res.wav);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
// ebur128 prints its summary on stderr.
const ebur = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
  encoding: 'utf8',
});
const summary = ebur.stderr.slice(ebur.stderr.lastIndexOf('Summary:')).split('\n[')[0]!;
const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
const truePeak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
console.log(summary.trim());
console.log(
  JSON.stringify(
    { renderMs: Math.round(ms), notes: res.notes, peak: res.peak, samples: res.samples, integratedLufs: lufs, truePeakDbtp: truePeak, crestDb: truePeak - lufs, wav, mp3 },
    null,
    2,
  ),
);
