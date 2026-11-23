/** `GET /api/music/:preset/sample?bpm=`: a short mastered WAV of a music preset at a tempo, for the picker's play button. */
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeWav, master, MUSIC_PRESETS, renderMusic } from '@reel/audio';
import { JobSpec } from '@reel/core';
import { checkSamples, mixStems, nodeSampleBank, SAMPLE_RATE } from '@reel/render';
import { RECIPES } from '@reel/styles';
import { buildCueSheet } from '@reel/timing';
import { PRESET_DEFAULT_BPM } from './catalog.ts';
import { HttpError } from './http.ts';

const SAMPLE_SECONDS = 12;
const samples = nodeSampleBank();
const inflight = new Map<string, Promise<string>>();

export function musicSample(dir: string, preset: string, bpmArg?: number): Promise<string> {
  if (!MUSIC_PRESETS.includes(preset)) throw new HttpError(404, `unknown music preset "${preset}" (known: ${MUSIC_PRESETS.join(', ')})`);
  const bpm = Math.round(bpmArg ?? PRESET_DEFAULT_BPM[preset] ?? 100);
  if (!(bpm >= 60 && bpm <= 180)) throw new HttpError(400, 'bpm must be 60–180');
  const path = join(dir, `sample-${preset}-${bpm}.wav`);
  let job = inflight.get(path);
  if (!job) {
    job = (async () => {
      if (await access(path).then(() => true, () => false)) return path;
      await checkSamples();
      // a title + end card job: the preset's groove with one landing at the start and a closing hit
      const spec = JobSpec.parse({
        id: 'music-sample',
        language: 'en',
        contentType: 'event',
        sections: [{ role: 'title', text: 'Sample' }, { role: 'endcard', logos: [], text: 'Sample' }],
        style: 'kinetic-quote',
        palette: 'flamingo-cafe',
        fonts: { display: 'rubik' },
        music: { source: 'preset', preset, bpm, seed: 1 },
        duration: SAMPLE_SECONDS,
        formats: ['9:16'],
      });
      const sheet = buildCueSheet({ spec, choreography: RECIPES['kinetic-quote']!.choreography, bpm, fps: 30 });
      const music = renderMusic(sheet, { preset, bpm, seed: 1 }, { samples, sampleRate: SAMPLE_RATE });
      const mastered = master(mixStems(music, null, SAMPLE_SECONDS)!);
      await mkdir(dir, { recursive: true });
      await writeFile(`${path}.tmp`, encodeWav(mastered, 16));
      await rename(`${path}.tmp`, path);
      return path;
    })().finally(() => inflight.delete(path));
    inflight.set(path, job);
  }
  return job;
}
