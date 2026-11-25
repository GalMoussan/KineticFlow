/**
 * P0 spike S5: compares the fingerprint dumps stills.ts writes (`fp-<format>-<t0>-<t1>.json`, copied per run into a
 * folder) between two runs: per format and window, equal or the JSON paths that differ.
 *
 *   node packages/render/dev/sketch/SketchRender-fpdiff.ts <dirA> <dirB>
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length > 12) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
    return;
  }
  out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`);
}

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) throw new Error('usage: SketchRender-fpdiff.ts <dirA> <dirB>');
const files = (await readdir(dirA)).filter((f) => /^fp-.*\.json$/.test(f) && !f.endsWith('-alt.json')).sort();
let same = 0;
for (const f of files) {
  const a = JSON.parse(await readFile(join(dirA, f), 'utf8'));
  const b = JSON.parse(await readFile(join(dirB, f), 'utf8').catch(() => 'null'));
  const d: string[] = [];
  diff(a, b, '', d);
  if (d.length === 0) same++;
  console.log(`${f.replace(/^fp-|\.json$/g, '').padEnd(14)} ${d.length ? `DIFFERENT\n    ${d.join('\n    ')}` : 'identical'}`);
}
console.log(`${same}/${files.length} identical`);
