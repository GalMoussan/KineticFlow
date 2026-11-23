/**
 * Dev harness for `reelPage.soundCues()`: renders nothing, only builds each style's page for a spec, reads its sound
 * cues and prints counts per kind, the densest second and the cue list (`out/dev/sounds-<style>.json`).
 *
 *   node packages/traits/dev/sounds.ts [--spec examples/dilemma.json] [--styles kinetic-quote,bass-pulse] [--format 9:16]
 *
 * Each style replaces the spec's style and palette (as `dev/stills.ts --style` does).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { JobSpec, SOUND_KINDS, type FormatId, type SoundCue } from '@reel/core';
import { buildCueSheet } from '../../timing/src/index.ts';
import { RECIPES, recipe } from '../../styles/src/index.ts';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '../src/index.ts';
import { buildBundle } from '../../render/src/bundle.ts';
import { reelInput } from '../../render/src/reel-input.ts';
import { launchBrowser, ReelTab } from '../../render/src/capture.ts';
import { serveDir } from '../../render/src/server.ts';
import { MAX_PER_SECOND } from '../src/lib/sound.ts';

const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/dev');
const { values: args } = parseArgs({ options: { spec: { type: 'string' }, styles: { type: 'string' }, format: { type: 'string' } } });
const specPath = resolve(args.spec ?? join(REPO, 'examples/dilemma.json'));
const specDir = dirname(specPath);
const styles = args.styles?.split(',') ?? Object.keys(RECIPES);
const fmt = (args.format ?? '9:16') as FormatId;

/** Largest number of attacks inside any 1 s window. */
function densest(cues: SoundCue[]): { n: number; at: number } {
  let best = { n: 0, at: 0 };
  for (let i = 0, j = 0; i < cues.length; i++) {
    while (cues[j]!.t <= cues[i]!.t - 1) j++;
    if (i - j + 1 > best.n) best = { n: i - j + 1, at: cues[j]!.t };
  }
  return best;
}

await mkdir(OUT, { recursive: true });
const raw = JSON.parse(await readFile(specPath, 'utf8'));
const browser = await launchBrowser();
let failed = false;
for (const style of styles) {
  const spec = JobSpec.parse({ ...raw, style, palette: recipe(style).defaults.palette });
  const res = resolveStyles(spec, RECIPES, TRAIT_META);
  assertResolved(res);
  const rec = recipe(res.job.recipe);
  const bpm = spec.music.source === 'preset' ? spec.music.bpm : rec.defaults.music.bpm;
  const sheet = buildCueSheet({ spec, choreography: rec.choreography, bpm, fps: 30 });
  const bundle = await buildBundle({ spec, specDir, outDir: join(OUT, `bundle-sounds-${style}`), traits: usedTraits(res) });
  const srv = await serveDir(bundle.dir);
  try {
    const input = await reelInput({ spec, sheet, formatId: fmt, specDir, bundle, styles: res });
    const tab = await ReelTab.open(browser, { origin: srv.url, entry: bundle.entry, input });
    const cues = await tab.soundCues();
    const again = await tab.soundCues();
    await tab.close();
    const counts = Object.fromEntries(SOUND_KINDS.map((k) => [k, cues.filter((c) => c.kind === k).length]).filter(([, n]) => n));
    const d = densest(cues);
    const sorted = cues.every((c, i) => i === 0 || cues[i - 1]!.t <= c.t);
    const ok = cues.length > 0 && sorted && d.n <= MAX_PER_SECOND && JSON.stringify(cues) === JSON.stringify(again);
    failed ||= !ok;
    console.log(`${style}: ${cues.length} cues ${JSON.stringify(counts)}; densest 1 s: ${d.n} at ${d.at.toFixed(2)} s; sorted ${sorted} ${ok ? 'ok' : 'FAIL'}`);
    await writeFile(join(OUT, `sounds-${style}.json`), JSON.stringify(cues, null, 1));
  } finally {
    await srv.close();
  }
}
await browser.close();
if (failed) process.exitCode = 1;
