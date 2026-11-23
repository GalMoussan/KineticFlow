/**
 * Node sample bank for this package's tests and dev scripts: `assets/samples/<id>.wav`, downloaded from the pinned
 * manifest URL when missing and SHA-256-checked. (`@reel/render` owns the production loader and `reelgen setup samples`;
 * both use the same cache path.)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SAMPLE_MANIFEST, decodeWav, type SampleBank, type Stereo } from '../src/index.ts';

export const SAMPLE_DIR = fileURLToPath(new URL('../../../assets/samples/', import.meta.url));

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Raw file bytes of every manifest entry, downloading the missing ones. */
export async function sampleBytes(): Promise<Map<string, Uint8Array>> {
  mkdirSync(SAMPLE_DIR, { recursive: true });
  const out = new Map<string, Uint8Array>();
  await Promise.all(
    SAMPLE_MANIFEST.map(async (e) => {
      const path = `${SAMPLE_DIR}${e.id}.wav`;
      let bytes: Uint8Array | null = existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
      if (!bytes || sha256(bytes) !== e.sha256) {
        const res = await fetch(e.url);
        if (!res.ok) throw new Error(`${e.id}: HTTP ${res.status} for ${e.url}`);
        bytes = new Uint8Array(await res.arrayBuffer());
        if (sha256(bytes) !== e.sha256) throw new Error(`${e.id}: SHA-256 mismatch for ${e.url}`);
        writeFileSync(path, bytes);
      }
      out.set(e.id, bytes);
    }),
  );
  return out;
}

/** A SampleBank over the cached files (decoded lazily, once). */
export async function loadSampleBank(): Promise<SampleBank> {
  const bytes = await sampleBytes();
  const decoded = new Map<string, Stereo>();
  return {
    get(id) {
      let s = decoded.get(id);
      if (!s) {
        const b = bytes.get(id);
        if (!b) return undefined;
        decoded.set(id, (s = decodeWav(b)));
      }
      return s;
    },
  };
}
