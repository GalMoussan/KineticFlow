/**
 * Word attachment (SKETCH-PLAN.md P5) in the real page: a word sketch's fingerprint entries carry its anchor word's
 * geometry, and moving the sketch to another word changes exactly the windows the sketch shows in. Builds the page
 * bundle and runs it in Chromium; skips when Chromium is unavailable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobSpec, type CueSheet, type SectionSketchInput } from '@reel/core';
import { RECIPES, recipe } from '@reel/styles';
import { buildCueSheet } from '@reel/timing';
import { assertResolved, resolveStyles, TRAIT_META, usedTraits } from '@reel/traits';
import { buildBundle } from './bundle.ts';
import { launchBrowser } from './capture.ts';
import { reelInput } from './reel-input.ts';
import { serveDir } from './server.ts';

const specDir = new URL('../../../examples/test-set/', import.meta.url).pathname;
const event = readFileSync(join(specDir, 'event-he.json'), 'utf8');

/** event-he in kinetic-quote, 9:16, 40 s (holds long enough already), with `sketches` on the tagline ("הנושאים הכי *מעניינים* ו*חמים* היום!"). */
function specWith(sketches: SectionSketchInput[] | null): JobSpec {
  const raw: Record<string, unknown> & { sections: Record<string, unknown>[] } = JSON.parse(event);
  Object.assign(raw, { style: 'kinetic-quote', formats: ['9:16'], duration: 40 });
  if (sketches) raw.sections[1] = { ...raw.sections[1], sketches };
  return JobSpec.parse(raw);
}
const circleOn = (item: number): SectionSketchInput[] => [{ id: 'circle-word', source: { kind: 'preset', preset: 'circle' }, place: { mode: 'word', item, fit: 'around' } }];

interface Entry {
  id: string;
  anchor?: { item: number; text: string; rest: { w: number; h: number }; geometry: { el: string[] } };
}
type Fingerprint = { overlays?: Entry[] };

test('word sketch fingerprint: carries its word\u2019s geometry; another word changes only the windows it shows in', async (t) => {
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  try {
    browser = await launchBrowser({ raster: 'cpu' });
  } catch (e) {
    t.skip(`Chromium unavailable: ${(e as Error).message.split('\n')[0]}`);
    return;
  }
  const out = mkdtempSync(join(tmpdir(), 'reel-word-'));
  try {
    const run = async (spec: JobSpec) => {
      const styles = resolveStyles(spec, RECIPES, TRAIT_META);
      assertResolved(styles);
      const sheet: CueSheet = buildCueSheet({ spec, choreography: recipe('kinetic-quote').choreography, bpm: 100, fps: 30, recipes: RECIPES });
      const bundle = await buildBundle({ spec, specDir, outDir: join(out, String(Math.random()).slice(2)), traits: usedTraits(styles) });
      const srv = await serveDir(bundle.dir);
      const input = await reelInput({ spec, sheet, formatId: '9:16', specDir, bundle, styles });
      const page = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
      await page.addInitScript((r: unknown) => Object.assign(window, { REEL: r }), input);
      await page.goto(`${srv.url}/index.html`);
      await page.evaluate(() => window.reelPage.ready());
      const windows: Record<string, string> = {};
      const entries: Record<string, Entry[]> = {};
      for (let a = 0; a < sheet.duration; a += 2) {
        const f = (await page.evaluate(([x, y]) => window.reelPage.fingerprint(x, y), [a, a + 2] as const)) as Fingerprint;
        windows[a] = JSON.stringify(f);
        entries[a] = f.overlays ?? [];
      }
      await page.context().close();
      await srv.close();
      const cin = sheet.cues.find((c) => c.type === 'sketch-in');
      const cout = sheet.cues.find((c) => c.type === 'sketch-out');
      return { windows, entries, sections: sheet.sections, span: cin && cout ? ([cin.t, cout.until!] as const) : null };
    };
    const [two, three, none] = [await run(specWith(circleOn(2))), await run(specWith(circleOn(3))), await run(specWith(null))];
    // the sketch changes no section time, so every difference below comes from the sketch alone
    assert.deepEqual(two.sections, none.sections);
    assert.deepEqual(three.sections, none.sections);
    const [tIn, tOut] = two.span!;
    assert.deepEqual(three.span, two.span);
    let shown = 0;
    for (const key of Object.keys(none.windows)) {
      const a = Number(key);
      const visible = tIn < a + 2 && tOut > a;
      if (!visible) {
        // windows without the sketch keep exactly the keys a job without it has
        assert.equal(two.windows[key], none.windows[key], `window ${a}`);
        assert.equal(three.windows[key], none.windows[key], `window ${a}`);
        continue;
      }
      shown++;
      const e2 = two.entries[key]!.find((e) => e.id === 'circle-word')!;
      const e3 = three.entries[key]!.find((e) => e.id === 'circle-word')!;
      // the entry names its word and carries the word's laid-out geometry; another word, other geometry
      assert.equal(e2.anchor?.item, 2);
      assert.equal(e2.anchor?.text, 'מעניינים');
      assert.equal(e3.anchor?.text, 'וחמים');
      assert.ok(e2.anchor!.rest.w > 0 && e2.anchor!.rest.h > 0);
      assert.notDeepEqual(e2.anchor!.geometry, e3.anchor!.geometry);
      assert.notEqual(two.windows[key], three.windows[key]);
    }
    assert.ok(shown >= 1 && shown < Object.keys(none.windows).length, `${shown} window(s) show the sketch`);
  } finally {
    await browser.close();
    rmSync(out, { recursive: true, force: true });
  }
});
