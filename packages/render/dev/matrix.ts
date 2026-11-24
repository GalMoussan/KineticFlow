/**
 * Acceptance matrix: every test spec × every style × every format the style supports.
 * Usage: node packages/render/dev/matrix.ts [--styles a,b] [--specs x,y] [--quality draft|standard] [--workers N]
 *        [--name report]
 * Writes out/matrix/<name>.md (default report.md) and out/matrix/sheet-<style>.png (9:16 frames at every section
 * hold, one row per spec). Use a small --workers and your own --name when several matrices run at once.
 */
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatSlug, JobSpec, type FormatId } from '@reel/core';
import { RECIPES } from '@reel/styles';
import { buildCueSheet } from '@reel/timing';
import { QaError, renderJob, type Receipt } from '../src/index.ts';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const { values } = parseArgs({
  options: {
    styles: { type: 'string' },
    specs: { type: 'string' },
    quality: { type: 'string', default: 'draft' },
    workers: { type: 'string' },
    name: { type: 'string', default: 'report' },
  },
});
const styles = values.styles?.split(',') ?? Object.keys(RECIPES);
const setDir = join(root, 'examples/test-set');
const specNames =
  values.specs?.split(',') ?? (await readdir(setDir)).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json'));
const outRoot = join(root, 'out/matrix');
const specDir = join(outRoot, 'specs');
await mkdir(specDir, { recursive: true });
await symlink(join(root, 'examples/assets'), join(specDir, 'assets')).catch(() => undefined);

interface Row {
  spec: string;
  style: string;
  ok: boolean;
  seconds: number;
  fails: string[];
  warns: string[];
  error?: string;
  receipt?: Receipt;
  holds: number[];
}
const rows: Row[] = [];

for (const style of styles) {
  const recipe = RECIPES[style]!;
  for (const name of specNames) {
    const raw = JSON.parse(await readFile(join(setDir, `${name}.json`), 'utf8'));
    // What a user gets on picking the style: its palette, fonts and music (preset + bpm decide the timing).
    Object.assign(raw, {
      id: `m-${name}-${style}`,
      style,
      palette: recipe.defaults.palette,
      fonts: { ...recipe.defaults.fonts },
      music: { source: 'preset', ...recipe.defaults.music, seed: raw.music?.seed ?? 1 },
      formats: recipe.constraints.formats,
    });
    const path = join(specDir, `${raw.id}.json`);
    await writeFile(path, JSON.stringify(raw, null, 2));
    const row: Row = { spec: name, style, ok: false, seconds: 0, fails: [], warns: [], holds: [] };
    const t0 = performance.now();
    try {
      const sheet = buildCueSheet({ spec: JobSpec.parse(raw), choreography: recipe.choreography, bpm: raw.music.bpm, fps: 30 });
      row.holds = sheet.sections.map((s) => s.timing.holdEnd - 1 / 30);
      const receipt = await renderJob(
        path,
        { quality: values.quality as 'draft', outDir: join(outRoot, 'jobs'), ...(values.workers ? { workers: Number(values.workers) } : {}) },
        () => undefined,
      );
      row.receipt = receipt;
      row.warns = receipt.qa.filter((g) => g.level === 'warn' && g.gate !== 'contrast').map((g) => `${g.gate} ${g.format ?? ''}`);
      row.ok = true;
    } catch (e) {
      if (e instanceof QaError) {
        row.fails = e.results.filter((g) => g.level === 'fail').map((g) => `${g.gate} ${g.format ?? ''}: ${g.detail}`);
      } else row.error = String(e instanceof Error ? e.message : e).split('\n')[0]!.slice(0, 240);
    }
    row.seconds = Math.round((performance.now() - t0) / 100) / 10;
    rows.push(row);
    console.log(`${row.ok ? '✓' : '✗'} ${style.padEnd(20)} ${name.padEnd(14)} ${row.seconds}s ${row.error ?? row.fails.join('; ')}`);
  }
}

for (const style of styles) {
  const tiles: string[] = [];
  for (const r of rows.filter((x) => x.style === style && x.receipt?.formats['9:16'])) {
    const tile = join(outRoot, `${style}-${r.spec}.png`);
    const sel = r.holds.map((t) => `eq(n\\,${Math.round(t * 30)})`).join('+');
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-i', r.receipt!.formats['9:16']!.outputs.video.path,
      '-vf', `select='${sel}',scale=180:-1,tile=8x1`, '-frames:v', '1', '-fps_mode', 'passthrough', tile,
    ]);
    tiles.push(tile);
  }
  if (tiles.length > 1) {
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', ...tiles.flatMap((t) => ['-i', t]),
      '-filter_complex', `${tiles.map((_, i) => `[${i}]`).join('')}vstack=inputs=${tiles.length}`,
      join(outRoot, `sheet-${style}.png`),
    ]);
  }
}

const formatsOf = (r: Row) => Object.keys(r.receipt?.formats ?? {}).map((f) => formatSlug(f as FormatId)).join(' ');
const md = [
  '| style | spec | result | formats | s | fails / error | warnings |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.style} | ${r.spec} | ${r.ok ? '✅' : '❌'} | ${formatsOf(r)} | ${r.seconds} | ${(r.error ?? r.fails.join('<br>')).replaceAll('|', '/')} | ${r.warns.join(', ')} |`,
  ),
].join('\n');
await writeFile(join(outRoot, `${values.name}.md`), md + '\n');
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} passed · out/matrix/${values.name}.md`);
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
