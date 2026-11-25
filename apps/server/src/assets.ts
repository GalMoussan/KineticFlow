/**
 * Uploads (`POST /api/assets`, multipart `file` + `kind` [+ `name`]): type and size checks, metadata, storage as
 * `data/assets/<id>.<ext>` where `id` is a unique slug of the file name (`ayalim.png` → `ayalim`, then `ayalim-2`).
 * Sketches (`.json` uploads or `POST /api/sketch/save`) are validated as `SketchDoc` and stored as canonical JSON in
 * `<id>.sketch.json`, with a plain SVG thumbnail `<id>.sketch.svg`.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Asset, AssetKind } from '@reel/api';
import { canonicalJson, SketchDoc, sketchSvg } from '@reel/core';
import { analyzeTrack, imageSize, logoColors, MODEL_PATH, readFont } from '@reel/render';
import { HttpError, slugify, uniqueSlug, newId } from './http.ts';
import type { Store } from './store.ts';

export const LIMITS: Record<AssetKind, { bytes: number; exts: readonly string[] }> = {
  logo: { bytes: 10 * 1024 * 1024, exts: ['png', 'svg', 'jpg'] },
  track: { bytes: 60 * 1024 * 1024, exts: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] },
  font: { bytes: 10 * 1024 * 1024, exts: ['ttf', 'otf', 'woff2'] },
  sketch: { bytes: 2 * 1024 * 1024, exts: ['json'] },
};

/** Stored file extension of a sketch asset (`<id>.sketch.json`) and of its thumbnail. */
export const SKETCH_EXT = 'sketch.json';
export const SKETCH_THUMB_EXT = 'sketch.svg';

/**
 * Validates `doc` as a `SketchDoc` and stores it as a `sketch` asset: canonical JSON (so the file's sha256 is the
 * doc's content hash) plus an SVG thumbnail. 422 with the first schema issues when it is not a valid drawing.
 */
export async function saveSketch(store: Store, dir: string, doc: unknown, name: string | undefined, log: (msg: string) => void): Promise<Asset> {
  const r = SketchDoc.safeParse(doc);
  if (!r.success) {
    const first = r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'doc'}: ${i.message}`);
    throw new HttpError(422, `not a valid sketch drawing: ${first.join('; ')}`);
  }
  const d = r.data;
  const bytes = new TextEncoder().encode(canonicalJson(d));
  const label = (name?.trim() || d.meta.prompt || `sketch ${d.mode}`).slice(0, 120);
  const id = uniqueSlug(slugify(label) || `sketch-${newId(6)}`, (x) => store.getAsset(x) !== undefined);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.${SKETCH_EXT}`), bytes);
  await writeFile(join(dir, `${id}.${SKETCH_THUMB_EXT}`), sketchSvg(d));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset = store.insertAsset({
    id,
    kind: 'sketch',
    name: label,
    ext: SKETCH_EXT,
    bytes: bytes.length,
    sha256,
    meta: {
      mode: d.mode,
      box: d.box,
      strokes: d.strokes.length,
      points: d.strokes.reduce((n, s) => n + s.pts.length, 0),
      source: d.meta.source,
      hash: sha256,
      thumb: `/files/assets/${encodeURIComponent(`${id}.${SKETCH_THUMB_EXT}`)}`,
    },
  });
  log(`asset sketch ${id} (${d.mode}, ${d.strokes.length} strokes)`);
  const { ext: _e, sha256: _s, ...out } = asset;
  return out;
}

function probeDuration(path: string): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (b: Buffer) => (out += b.toString()));
  child.stderr.on('data', (b: Buffer) => (err += b.toString()));
  child.on('error', reject);
  child.on('close', (code) => {
    const d = Number(out.trim());
    if (code === 0 && Number.isFinite(d) && d > 0) resolve(d);
    else reject(new Error(err.trim().split('\n').at(-1) || 'not a readable audio file'));
  });
  return promise;
}

async function metaOf(kind: Exclude<AssetKind, 'sketch'>, ext: string, bytes: Uint8Array, path: string): Promise<Record<string, unknown>> {
  switch (kind) {
    case 'logo': {
      if (ext === 'svg' && !/<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)))) throw new Error('not an SVG file');
      const size = imageSize(bytes, ext);
      return { ...size, colors: logoColors(bytes, ext) };
    }
    case 'font': {
      const f = readFont(bytes);
      if (f.format !== ext && !(f.format === 'ttf' && ext === 'otf') && !(f.format === 'otf' && ext === 'ttf')) {
        throw new Error(`the file is a ${f.format.toUpperCase()} font, not .${ext}`);
      }
      return { family: f.family, weights: f.weights, scripts: f.scripts, axes: f.axes, hebrew: f.scripts.includes('hebrew') };
    }
    case 'track':
      return { duration: Math.round((await probeDuration(path)) * 1000) / 1000 };
  }
}

export interface Upload {
  file: File;
  kind: AssetKind;
  name?: string | undefined;
}

export async function ingestAsset(store: Store, dir: string, u: Upload, log: (msg: string) => void): Promise<Asset> {
  const limit = LIMITS[u.kind];
  const original = u.file.name || 'upload';
  let ext = (/\.([A-Za-z0-9]+)$/.exec(original)?.[1] ?? '').toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (!limit.exts.includes(ext)) {
    throw new HttpError(415, `a ${u.kind} must be ${limit.exts.map((e) => `.${e}`).join(', ')} (got "${original}")`);
  }
  if (u.file.size > limit.bytes) {
    throw new HttpError(413, `${original} is ${(u.file.size / 1048576).toFixed(1)} MB; ${u.kind}s can be up to ${limit.bytes / 1048576} MB`);
  }
  if (u.file.size === 0) throw new HttpError(400, `${original} is empty`);
  const bytes = new Uint8Array(await u.file.arrayBuffer());
  if (u.kind === 'sketch') {
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new HttpError(422, `${original} is not JSON`);
    }
    return saveSketch(store, dir, doc, u.name ?? original.replace(/\.(sketch\.)?json$/i, ''), log);
  }
  const name = (u.name?.trim() || original.replace(/\.[^.]+$/, '')).slice(0, 120);
  const id = uniqueSlug(slugify(name) || `${u.kind}-${newId(6)}`, (x) => store.getAsset(x) !== undefined);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.${ext}`);
  await writeFile(path, bytes);
  let meta: Record<string, unknown>;
  try {
    meta = await metaOf(u.kind, ext, bytes, path);
  } catch (e) {
    await rm(path, { force: true });
    throw new HttpError(422, `${original}: ${(e as Error).message}`);
  }
  const asset = store.insertAsset({
    id,
    kind: u.kind,
    name,
    ext,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    meta,
  });
  log(`asset ${u.kind} ${id}.${ext} (${(bytes.length / 1024).toFixed(0)} KB)`);
  if (u.kind === 'track') void analyzeInBackground(store, id, path, log);
  const { ext: _e, sha256: _s, ...out } = asset;
  return out;
}

/** Beat analysis of an uploaded track (cached by the sidecar), so validation and previews know its tempo early. */
async function analyzeInBackground(store: Store, id: string, path: string, log: (msg: string) => void): Promise<void> {
  if (!(await access(MODEL_PATH).then(() => true, () => false))) return;
  try {
    const t0 = performance.now();
    const { analysis } = await analyzeTrack(path);
    const asset = store.getAsset(id);
    if (!asset) return;
    store.updateAssetMeta(id, { ...asset.meta, bpm: analysis.bpm, meter: analysis.meter, beats: analysis.beats.length });
    log(`asset track ${id}: ${analysis.bpm?.toFixed(1) ?? '?'} bpm, ${analysis.beats.length} beats (${Math.round(performance.now() - t0)} ms)`);
  } catch (e) {
    log(`asset track ${id}: analysis failed: ${(e as Error).message.split('\n')[0]}`);
  }
}
