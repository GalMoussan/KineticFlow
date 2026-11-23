/**
 * Live preview sessions (`POST /api/preview`): spec → styles → music stage (cached by music + cue-sheet inputs) →
 * page bundle (cached by traits/fonts/logos) → `window.REEL` for one format. The page is served same-origin at
 * `/preview/<id>/index.html` with REEL inlined before the engine script and the capture CSP, so the iframe player
 * shows exactly what the renderer captures. `audio()` mixes the page's sound cues over the music with the render's
 * own mix + master.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PreviewSession, SpecIssue } from '@reel/api';
import { encodeWav, master, renderSfx, type Stereo } from '@reel/audio';
import { format as formatOf, JobSpec, SOUND_KINDS, type Choreography, type FormatId, type ReelInput, type SoundCue } from '@reel/core';
import {
  buildBundle,
  checkSamples,
  mixStems,
  nodeSampleBank,
  prepareMusic,
  reelInput,
  resolveQuality,
  SAMPLE_RATE,
  specFontIds,
  type Bundle,
  type MusicStage,
} from '@reel/render';
import { RECIPES } from '@reel/styles';
import { TimingError } from '@reel/timing';
import { resolveStyles, TRAIT_META, usedTraits, type StyleResolution } from '@reel/traits';
import { HttpError, issuePath, newId } from './http.ts';
import type { Store } from './store.ts';

/** Small insertion-ordered LRU. */
export class Lru<K, V> {
  readonly #max: number;
  readonly #map = new Map<K, V>();
  constructor(max: number) {
    this.#max = max;
  }
  get(k: K): V | undefined {
    const v = this.#map.get(k);
    if (v !== undefined) {
      this.#map.delete(k);
      this.#map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.#map.delete(k);
    this.#map.set(k, v);
    while (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value!);
  }
  delete(k: K): void {
    this.#map.delete(k);
  }
  get size(): number {
    return this.#map.size;
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const exists = (p: string) => access(p).then(() => true, () => false);

interface MusicEntry {
  key: string;
  stage: MusicStage;
  /** Preset seed (the SFX seed of the render path); 0 otherwise. */
  seed: number;
  /** Seconds of audio: frames / fps. */
  duration: number;
  musicUrl: string | null;
}

export interface Session {
  id: string;
  spec: JobSpec;
  format: FormatId;
  input: ReelInput;
  bundle: Bundle;
  music: MusicEntry;
  /** ms per step of the request that created it. */
  timings: Record<string, number>;
}

export interface PreviewTimings {
  total: number;
  [step: string]: number;
}

/** The page's init: seeded Math.random (as in capture) and REEL, both before any engine script runs. */
function inlineScript(input: ReelInput): string {
  const json = JSON.stringify(input).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>(() => {
  if (!('__reelSeed' in window)) {
    let a = 0x9E3779B9;
    Object.defineProperty(window, '__reelSeed', { value: (f) => { a = (f * 2654435761 + 97) >>> 0; } });
    Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  window.REEL = ${json};
})();</script>`;
}

/** Spec parse + style resolution, as `HttpError(422)` with issues on failure. */
export function parseForPreview(raw: unknown): { spec: JobSpec; styles: StyleResolution } {
  const parsed = JobSpec.safeParse(raw);
  if (!parsed.success) {
    const issues: SpecIssue[] = parsed.error.issues.map((i) => ({ path: issuePath(i.path), message: i.message, level: 'error' }));
    throw new HttpError(422, `the spec is not valid yet: ${issues[0]!.path.join('.') || 'spec'}: ${issues[0]!.message}`, issues);
  }
  const spec = parsed.data;
  if (spec.music.source === 'ai') throw new HttpError(422, 'AI music arrives in a later version', [{ path: ['music', 'source'], message: 'not available yet', level: 'error' }]);
  const styles = resolveStyles(spec, RECIPES, TRAIT_META);
  const errors = styles.diagnostics.filter((d) => d.level === 'error');
  if (errors.length || !styles.job) {
    throw new HttpError(
      422,
      errors.map((d) => d.message).join('; ') || 'the style did not resolve',
      errors.map((d) => ({ path: ['style'], message: d.message, level: 'error' as const })),
    );
  }
  return { spec, styles };
}

export class PreviewService {
  readonly #dir: string;
  readonly #specDir: string;
  readonly #store: Store;
  readonly #log: (msg: string) => void;
  readonly #sessions = new Lru<string, Session>(20);
  readonly #music = new Lru<string, Promise<MusicEntry>>(8);
  readonly #bundles = new Map<string, Promise<Bundle>>();
  readonly #pages = new Map<string, Promise<string>>();
  readonly #samples = nodeSampleBank();
  readonly #mixes = new Map<string, Promise<string>>();

  constructor(o: { dir: string; specDir: string; store: Store; log: (msg: string) => void }) {
    this.#dir = o.dir;
    this.#specDir = o.specDir;
    this.#store = o.store;
    this.#log = o.log;
  }

  get audioDir(): string {
    return join(this.#dir, 'audio');
  }

  session(id: string): Session | undefined {
    return this.#sessions.get(id);
  }

  async create(raw: unknown, formatId: FormatId, o: { quiet?: boolean } = {}): Promise<{ session: Session; response: PreviewSession }> {
    const t0 = performance.now();
    const timings: Record<string, number> = {};
    let t = t0;
    const lap = (name: string) => {
      const n = performance.now();
      timings[name] = Math.round(n - t);
      t = n;
    };
    const { spec, styles } = parseForPreview(raw);
    const rec = RECIPES[styles.job!.recipe]!;
    lap('parse');

    const music = await this.#musicFor(spec, rec.choreography, rec.defaults.music.bpm, timings);
    lap('music');
    const bundle = await this.#bundleFor(spec, styles, timings);
    lap('bundle');
    const input = await reelInput({ spec, sheet: music.stage.sheet, formatId, specDir: this.#specDir, bundle, styles });
    lap('input');

    const id = newId(10);
    const session: Session = { id, spec, format: formatId, input, bundle, music, timings };
    this.#sessions.set(id, session);
    timings.total = Math.round(performance.now() - t0);
    if (!o.quiet) {
      this.#log(
        `preview ${id} ${formatId} · ${styles.job!.recipe} · music ${timings.musicCached ? 'cached' : `${timings.music} ms`} · ` +
          `bundle ${timings.bundleCached ? 'cached' : `${timings.bundle} ms`} · ${timings.total} ms`,
      );
    }
    const sheet = music.stage.sheet;
    const f = formatOf(formatId);
    return {
      session,
      response: {
        id,
        url: `/preview/${id}/index.html`,
        width: f.w,
        height: f.h,
        duration: sheet.duration,
        fps: sheet.fps,
        sections: sheet.sections.map((s) => ({
          id: s.id,
          role: s.role,
          in: s.timing.in,
          holdStart: s.timing.holdStart,
          holdEnd: s.timing.holdEnd,
          out: s.timing.out,
        })),
        safe: { ...f.safe },
        musicUrl: music.musicUrl,
        bpm: sheet.bpm ?? 0,
      },
    };
  }

  async #musicFor(spec: JobSpec, choreography: Choreography, defaultBpm: number, timings: Record<string, number>): Promise<MusicEntry> {
    const fps = resolveQuality(spec.quality).fps;
    const track = spec.music.source === 'track' ? this.#store.getAsset(spec.music.file)?.sha256 : undefined;
    // everything the cue sheet and the music stem depend on (per-section looks do not change timing)
    const key = sha(
      JSON.stringify({
        v: 1,
        music: spec.music,
        duration: spec.duration,
        language: spec.language,
        sections: spec.sections.map(({ style: _s, palette: _p, ...rest }) => rest),
        choreography,
        defaultBpm,
        fps,
        track,
      }),
    );
    const hit = this.#music.get(key);
    if (hit) {
      timings.musicCached = 1;
      return hit;
    }
    const job = (async (): Promise<MusicEntry> => {
      if (spec.music.source === 'preset' || spec.sfx) await checkSamples();
      let stage: MusicStage;
      try {
        stage = await prepareMusic({ spec, specDir: this.#specDir, choreography, fps, samples: this.#samples, defaultBpm });
      } catch (e) {
        if (e instanceof TimingError) throw new HttpError(422, e.message, [{ path: ['duration'], message: e.message, level: 'error' }]);
        throw e;
      }
      const duration = stage.sheet.frames / stage.sheet.fps;
      let musicUrl: string | null = null;
      if (stage.music) {
        const file = `music-${key.slice(0, 24)}.wav`;
        await this.#writeWav(file, master(mixStems(stage.music, null, duration)!));
        musicUrl = `/files/preview/audio/${file}`;
      }
      return { key, stage, seed: spec.music.source === 'preset' ? spec.music.seed : 0, duration, musicUrl };
    })();
    this.#music.set(key, job);
    job.catch(() => this.#music.delete(key));
    return job;
  }

  async #bundleFor(spec: JobSpec, styles: StyleResolution, timings: Record<string, number>): Promise<Bundle> {
    const traits = usedTraits(styles);
    const logos = [...new Set(spec.sections.flatMap((s) => (s.role === 'endcard' ? s.logos : [])))].sort();
    const key = sha(JSON.stringify({ traits, fonts: specFontIds(spec), logos, language: spec.language })).slice(0, 20);
    const hit = this.#bundles.get(key);
    if (hit) {
      timings.bundleCached = 1;
      return hit;
    }
    const job = buildBundle({ spec, specDir: this.#specDir, outDir: join(this.#dir, 'bundles', key), traits });
    this.#bundles.set(key, job);
    job.catch(() => this.#bundles.delete(key));
    return job;
  }

  async #writeWav(file: string, audio: Stereo): Promise<string> {
    const path = join(this.audioDir, file);
    if (await exists(path)) return path;
    await mkdir(this.audioDir, { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, encodeWav(audio, 16));
    await rename(tmp, path);
    return path;
  }

  /** `index.html` of a session: the bundle's page with REEL inlined before `engine.js`. */
  async page(id: string): Promise<string | null> {
    const s = this.#sessions.get(id);
    if (!s) return null;
    let html = this.#pages.get(s.bundle.dir);
    if (!html) {
      html = readFile(join(s.bundle.dir, s.bundle.entry), 'utf8');
      this.#pages.set(s.bundle.dir, html);
    }
    const page = await html;
    const at = page.indexOf('<script src="engine.js">');
    if (at < 0) throw new Error(`bundle page ${s.bundle.dir} has no engine script`);
    return page.slice(0, at) + inlineScript(s.input) + page.slice(at);
  }

  /** Music + the page's sound cues → SFX stem → the render's mix + master → WAV URL (cached by cues). */
  async audio(id: string, rawCues: unknown[]): Promise<string> {
    const s = this.#sessions.get(id);
    if (!s) throw new HttpError(404, `preview session ${id} expired; request a new preview`);
    const cues: SoundCue[] = s.spec.sfx ? rawCues.filter(isCue) : [];
    const key = sha(JSON.stringify({ music: s.music.key, cues, seed: s.music.seed })).slice(0, 24);
    let job = this.#mixes.get(key);
    if (!job) {
      job = (async () => {
        const t0 = performance.now();
        const file = `mix-${key}.wav`;
        if (!(await exists(join(this.audioDir, file)))) {
          const sfx = cues.length
            ? renderSfx(cues, { duration: s.music.duration, seed: s.music.seed, samples: this.#samples, sampleRate: SAMPLE_RATE })
            : null;
          const pre = mixStems(s.music.stage.music, sfx, s.music.duration);
          const n = Math.round(s.music.duration * SAMPLE_RATE);
          await this.#writeWav(file, pre ? master(pre) : { l: new Float32Array(n), r: new Float32Array(n), sampleRate: SAMPLE_RATE });
          this.#log(`preview ${id} audio · ${cues.length} sound cue(s) · ${Math.round(performance.now() - t0)} ms`);
        }
        return `/files/preview/audio/${file}`;
      })();
      this.#mixes.set(key, job);
      job.catch(() => this.#mixes.delete(key));
    }
    return job;
  }
}

function isCue(c: unknown): c is SoundCue {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  return (
    typeof x.t === 'number' &&
    Number.isFinite(x.t) &&
    typeof x.weight === 'number' &&
    typeof x.kind === 'string' &&
    (SOUND_KINDS as readonly string[]).includes(x.kind) &&
    (x.until === undefined || typeof x.until === 'number') &&
    (x.pan === undefined || typeof x.pan === 'number') &&
    (x.pitch === undefined || typeof x.pitch === 'number')
  );
}
