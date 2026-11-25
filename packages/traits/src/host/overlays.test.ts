import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every non-test `.ts` file under `dir`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

// Page-side code: the host, shared libs, every trait, and the runtime. (`src/resolve.ts`, `registry.ts` and `index.ts`
// run in Node only and may import values.)
test('page code: value imports from @reel/core never go through its index (zod would enter the bundle; CSP blocks its eval)', () => {
  const roots = ['./', '../lib/', '../traits/', '../../../runtime/src/'].map((r) => fileURLToPath(new URL(r, import.meta.url)));
  const files = roots.flatMap(sources);
  assert.ok(files.length > 50, `scanned only ${files.length} files`);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const bad = [...src.matchAll(/^import\s+(?!type\b)[^;]*from '@reel\/core'/gm)].map((m) => m[0]);
    assert.deepEqual(bad, [], `${f}: ${bad.join('; ')}`);
  }
});
