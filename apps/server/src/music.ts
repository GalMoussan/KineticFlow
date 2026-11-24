/**
 * Music endpoints: `GET /api/music/:preset/sample?bpm=` (a short mastered WAV of a preset at a tempo, for the picker's
 * play button) and the AI music jobs behind `/api/music-ai` (ACE-Step add-on; one job per clip key, progress fanned
 * out to SSE subscribers).
 */
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MusicAiState } from '@reel/api';
import { encodeWav, master, MUSIC_PRESETS, PRESET_DEFAULT_BPM, renderMusic } from '@reel/audio';
import { JobSpec } from '@reel/core';
import { cachedMusicAi, checkSamples, generateMusicAi, mixStems, MUSIC_AI_CACHE, musicAiKey, nodeSampleBank, SAMPLE_RATE, type MusicAiRequest } from '@reel/render';
import { RECIPES } from '@reel/styles';
import { buildCueSheet } from '@reel/timing';
import { HttpError } from './http.ts';

type Listener = (s: MusicAiState) => void;

/** AI clips of this server run, by cache key: one generation per key, its progress fanned out to subscribers. */
export class MusicAiJobs {
  readonly #jobs = new Map<string, { state: MusicAiState; listeners: Set<Listener> }>();
  readonly #log: (msg: string) => void;
  constructor(log: (msg: string) => void) {
    this.#log = log;
  }

  /** Starts the clip, joins its running job, or answers from the cache (`cachedOnly`: 404 when not generated). */
  async start(r: MusicAiRequest & { cachedOnly?: boolean | undefined }): Promise<MusicAiState> {
    const { key } = await musicAiKey(r);
    const known = this.#jobs.get(key);
    if (known && known.state.status !== 'error') return known.state;
    const listeners = known?.listeners ?? new Set<Listener>();
    if (await cachedMusicAi(r)) {
      const state: MusicAiState = { key, status: 'done', progress: 1, stage: 'cached', url: `/api/music-ai/${key}/audio`, cached: true, ms: 0 };
      this.#jobs.set(key, { state, listeners });
      return state;
    }
    if (r.cachedOnly) throw new HttpError(404, 'this AI music is not generated yet');
    this.#jobs.set(key, { state: { key, status: 'running', progress: 0, stage: 'starting' }, listeners });
    generateMusicAi(r, (progress, stage) => this.#update(key, { progress, stage })).then(
      (res) => {
        this.#update(key, { status: 'done', progress: 1, stage: res.cached ? 'cached' : 'generated', url: `/api/music-ai/${key}/audio`, cached: res.cached, ms: Math.round(res.ms) });
        if (!res.cached) this.#log(`music-ai ${key.slice(0, 12)} · ${res.duration} s clip generated in ${(res.ms / 1000).toFixed(1)} s`);
      },
      (e: Error) => this.#update(key, { status: 'error', stage: 'failed', error: e.message }),
    );
    return this.#jobs.get(key)!.state;
  }

  state(key: string): MusicAiState | undefined {
    return this.#jobs.get(key)?.state;
  }

  /** Calls `fn` on every change of the job's state; returns the unsubscribe. */
  subscribe(key: string, fn: Listener): () => void {
    const job = this.#jobs.get(key);
    if (!job) return () => {};
    job.listeners.add(fn);
    return () => job.listeners.delete(fn);
  }

  /** The clip's WAV path (generated in this or an earlier run). */
  audioPath(key: string): string {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new HttpError(400, 'bad clip key');
    return join(MUSIC_AI_CACHE, `${key}.wav`);
  }

  #update(key: string, patch: Partial<MusicAiState>): void {
    const job = this.#jobs.get(key);
    if (!job) return;
    job.state = { ...job.state, ...patch };
    for (const fn of job.listeners) fn(job.state);
  }
}

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
