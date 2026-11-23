/**
 * CC0 one-shot samples (PLAN.md §11): `reelgen setup samples` downloads `SAMPLE_MANIFEST` into `assets/samples/<id>.wav`
 * (git-ignored), each checked against its SHA-256. Renders read only these local copies through `nodeSampleBank`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeWav, SAMPLE_MANIFEST, type SampleBank, type Stereo } from '@reel/audio';
import { REPO } from './util.ts';

export const SAMPLE_DIR = join(REPO, 'assets/samples');
export const samplePath = (id: string) => join(SAMPLE_DIR, `${id}.wav`);

/** A required local asset is missing: the message names the `reelgen setup` step that installs it. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function hasValid(path: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

/**
 * Downloads `url` to `path` unless a file with the expected SHA-256 is already there. The bytes are checked before
 * they land (temp file + rename), so a corrupt or partial download never replaces anything.
 * Returns the downloaded byte count, or 0 when the local copy was already valid.
 */
export async function downloadVerified(url: string, path: string, expected: string, label: string): Promise<number> {
  if (await hasValid(path, expected)) return 0;
  await mkdir(dirname(path), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: download failed (${res.status} ${res.statusText}) from ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = sha256(bytes);
  if (got !== expected) throw new Error(`${label}: sha256 mismatch for ${url} (expected ${expected}, got ${got})`);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return bytes.length;
}

/** Downloads and verifies every manifest sample. */
export async function setupSamples(log: (msg: string) => void): Promise<void> {
  let fetched = 0;
  for (const s of SAMPLE_MANIFEST) {
    const n = await downloadVerified(s.url, samplePath(s.id), s.sha256, `sample "${s.id}"`);
    if (n) {
      fetched++;
      log(`sample ${s.id}: downloaded (${(n / 1024).toFixed(0)} KB, ${s.license})`);
    }
  }
  log(`samples: ${SAMPLE_MANIFEST.length} verified in ${SAMPLE_DIR} (${fetched} downloaded)`);
}

/** Every manifest sample is present (size only; contents are verified when a sample is first decoded). */
export async function checkSamples(): Promise<void> {
  const missing: string[] = [];
  for (const s of SAMPLE_MANIFEST) {
    if (!(await stat(samplePath(s.id)).then((x) => x.size > 0, () => false))) missing.push(s.id);
  }
  if (missing.length) {
    throw new SetupError(
      `${missing.length} of ${SAMPLE_MANIFEST.length} audio samples are missing (${missing.slice(0, 4).join(', ')}` +
        `${missing.length > 4 ? ', …' : ''}): run \`reelgen setup samples\``,
    );
  }
}

/**
 * Node `SampleBank`: decodes `<id>.wav` on first use (SHA-256-checked against the manifest) and keeps it. Unknown ids
 * are `undefined`; a known id whose file is missing or corrupt throws a `SetupError`.
 */
export function nodeSampleBank(): SampleBank {
  const entries = new Map(SAMPLE_MANIFEST.map((s) => [s.id, s]));
  const cache = new Map<string, Stereo>();
  return {
    get(id: string): Stereo | undefined {
      const hit = cache.get(id);
      if (hit) return hit;
      const entry = entries.get(id);
      if (!entry) return undefined;
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(samplePath(id));
      } catch {
        throw new SetupError(`audio sample "${id}" is missing: run \`reelgen setup samples\``);
      }
      if (sha256(bytes) !== entry.sha256) throw new SetupError(`audio sample "${id}" is corrupt: run \`reelgen setup samples\``);
      const decoded = decodeWav(bytes);
      cache.set(id, decoded);
      return decoded;
    },
  };
}
