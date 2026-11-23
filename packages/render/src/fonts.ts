/**
 * Local font cache (PLAN.md §11): catalog fonts live in `<repo>/assets/fonts/<file>` (git-ignored), downloaded once
 * from the catalog URL and verified by SHA-256. Pages only ever load these local copies.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fontEntry } from '@reel/core';

export const FONT_DIR = new URL('../../../assets/fonts/', import.meta.url).pathname;

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function readIfValid(path: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expected;
  } catch {
    return false;
  }
}

/** Font id → absolute path of the verified local file. Missing or corrupt files are (re)downloaded. */
export async function ensureFonts(ids: string[], log?: (msg: string) => void): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const f = fontEntry(id);
    const path = join(FONT_DIR, f.file);
    if (!(await readIfValid(path, f.sha256))) {
      await mkdir(FONT_DIR, { recursive: true });
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`font "${id}": download failed (${res.status} ${res.statusText}) from ${f.url}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const got = sha256(bytes);
      if (got !== f.sha256) throw new Error(`font "${id}": sha256 mismatch for ${f.url} (expected ${f.sha256}, got ${got})`);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
      log?.(`font ${id}: downloaded ${f.file} (${(bytes.length / 1024).toFixed(0)} KB)`);
    }
    out[id] = path;
  }
  return out;
}
