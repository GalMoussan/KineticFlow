/**
 * Renders a job through the real pipeline with the fixture page instead of the style engine's bundle.
 * Usage: node packages/render/test/fixture/run.ts [job.json] [quality] [formats]
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobSpec } from '@reel/core';
import { renderJobWith, type RenderEvent, type Preset } from '../../src/index.ts';
import type { Bundle } from '../../src/bundle.ts';
import { REPO } from '../../src/util.ts';
import type { FormatId } from '@reel/core';

const here = new URL('.', import.meta.url).pathname;

/** Copies the fixture page and the spec's logos into `outDir`. */
export async function fixtureBundle(o: { spec: JobSpec; specDir: string; outDir: string }): Promise<Bundle> {
  await mkdir(join(o.outDir, 'logos'), { recursive: true });
  const files = ['index.html', 'fixture.js', 'fixture.css'];
  for (const f of files) await copyFile(join(here, f), join(o.outDir, f));
  for (const s of o.spec.sections) {
    if (s.role !== 'endcard') continue;
    for (const id of s.logos) {
      await copyFile(join(o.specDir, 'assets', `${id}.png`), join(o.outDir, 'logos', `${id}.png`));
      files.push(`logos/${id}.png`);
    }
  }
  const hash = createHash('sha256');
  for (const f of files.sort()) hash.update(f).update(await readFile(join(o.outDir, f)));
  return { dir: o.outDir, entry: 'index.html', hash: hash.digest('hex') };
}

if (import.meta.main) {
  const [spec = join(REPO, 'examples/dilemma.json'), quality = 'draft', formats] = process.argv.slice(2);
  const t0 = performance.now();
  const receipt = await renderJobWith(
    spec,
    {
      quality: quality as Preset,
      outDir: join(REPO, 'data/fixture-out'),
      ...(formats ? { formats: formats.split(',') as FormatId[] } : {}),
    },
    (e: RenderEvent) => {
      if (e.type !== 'chunk') console.log(JSON.stringify(e));
    },
    fixtureBundle,
  );
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s →`, receipt.outDir, await readdir(receipt.outDir));
}
