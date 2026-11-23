import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pruneCaches } from './cache.ts';

test('pruneCaches removes least recently used entries first, sparing kept and fresh ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reel-cache-'));
  try {
    const chunks = join(root, 'chunks');
    const bundles = join(root, 'bundles');
    await mkdir(join(bundles, 'b-old'), { recursive: true });
    await mkdir(chunks);
    const hour = 3_600_000;
    const files: [string, number][] = [
      [join(chunks, 'a.mp4'), 5], // oldest, but kept
      [join(chunks, 'b.mp4'), 4],
      [join(bundles, 'b-old', 'index.js'), 3], // a directory entry counts as one
      [join(chunks, 'c.mp4'), 2],
      [join(chunks, 'd.mp4'), 0], // fresh: inside minAge
    ];
    for (const [path, hoursAgo] of files) {
      await writeFile(path, Buffer.alloc(100));
      const t = new Date(Date.now() - hoursAgo * hour);
      await utimes(path, t, t);
    }
    const old = new Date(Date.now() - 3 * hour);
    await utimes(join(bundles, 'b-old'), old, old);

    const r = await pruneCaches({ dirs: [chunks, bundles], budget: 300, keep: [join(chunks, 'a.mp4')], minAgeMs: hour });
    assert.deepEqual(await readdir(chunks).then((n) => n.sort()), ['a.mp4', 'c.mp4', 'd.mp4']);
    assert.deepEqual(await readdir(bundles), []);
    assert.deepEqual(r, { removed: 2, freed: 200, left: 300 });

    const all = await pruneCaches({ dirs: [chunks, bundles], budget: 0, minAgeMs: 0 });
    assert.equal(all.left, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
