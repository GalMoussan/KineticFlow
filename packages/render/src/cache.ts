/**
 * Size-bounded LRU for everything Reel Studio can recompute (PLAN.md §8.4, M5): rendered chunks, preview audio,
 * preview bundles and style stills. Recency is the file's mtime: a cache hit `touch`es the file, so pruning removes
 * what was used longest ago. Outputs (`out/`), uploaded assets and the analysis cache are never pruned here.
 */
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { CHUNK_DIR } from './chunks.ts';
import { REPO } from './util.ts';

export const CACHE_DIRS = [
  CHUNK_DIR,
  join(REPO, 'data/preview/audio'),
  join(REPO, 'data/preview/bundles'),
  join(REPO, 'data/preview/stills'),
];

/** Default budget for all caches together; override with `REEL_CACHE_MB`. */
export const DEFAULT_CACHE_MB = 2048;

export function cacheBudgetBytes(): number {
  const mb = Number(process.env.REEL_CACHE_MB);
  return (Number.isFinite(mb) && mb >= 0 ? mb : DEFAULT_CACHE_MB) * 1024 * 1024;
}

/** Marks a cache entry as just used (LRU recency). Missing files are ignored. */
export async function touch(path: string): Promise<void> {
  const now = new Date();
  await utimes(path, now, now).catch(() => {});
}

interface Entry {
  /** File, or a top-level directory treated as one entry (bundles, stills sets). */
  path: string;
  bytes: number;
  mtime: number;
}

async function treeSize(path: string): Promise<{ bytes: number; mtime: number }> {
  const s = await stat(path);
  if (!s.isDirectory()) return { bytes: s.size, mtime: s.mtimeMs };
  let bytes = 0;
  let mtime = s.mtimeMs;
  for (const e of await readdir(path, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = await stat(join(e.parentPath, e.name));
    bytes += f.size;
    mtime = Math.max(mtime, f.mtimeMs);
  }
  return { bytes, mtime };
}

async function entries(dirs: readonly string[]): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith('.tmp')) continue; // in-flight writes
      const path = join(dir, name);
      const s = await treeSize(path).catch(() => null);
      if (s) out.push({ path, ...s });
    }
  }
  return out;
}

export interface CacheUsage {
  bytes: number;
  entries: number;
  budget: number;
  byDir: Record<string, number>;
}

export async function cacheUsage(dirs: readonly string[] = CACHE_DIRS): Promise<CacheUsage> {
  const es = await entries(dirs);
  const byDir: Record<string, number> = {};
  for (const d of dirs) byDir[d] = es.filter((e) => e.path.startsWith(d + '/')).reduce((n, e) => n + e.bytes, 0);
  return { bytes: es.reduce((n, e) => n + e.bytes, 0), entries: es.length, budget: cacheBudgetBytes(), byDir };
}

export interface PruneResult {
  removed: number;
  freed: number;
  /** Total bytes left in the caches. */
  left: number;
}

/**
 * Deletes least-recently-used entries until the caches fit `budget`. Paths in `keep` (the job that just finished)
 * and entries used within `minAgeMs` (default 10 min: open preview sessions still fetch their bundle and audio) are
 * never removed, even if the caches stay over budget.
 */
export async function pruneCaches(
  o: { budget?: number; keep?: Iterable<string>; dirs?: readonly string[]; minAgeMs?: number } = {},
): Promise<PruneResult> {
  const budget = o.budget ?? cacheBudgetBytes();
  const keep = new Set(o.keep ?? []);
  const es = await entries(o.dirs ?? CACHE_DIRS);
  let total = es.reduce((n, e) => n + e.bytes, 0);
  let removed = 0;
  let freed = 0;
  const cutoff = Date.now() - (o.minAgeMs ?? 10 * 60_000);
  for (const e of es.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path))) {
    if (total <= budget) break;
    if (keep.has(e.path) || e.mtime > cutoff) continue;
    await rm(e.path, { recursive: true, force: true });
    total -= e.bytes;
    freed += e.bytes;
    removed++;
  }
  return { removed, freed, left: total };
}
