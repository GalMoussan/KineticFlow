import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Store } from './store.ts';
import { validateSpec } from './validate.ts';

const dir = mkdtempSync(join(tmpdir(), 'reel-validate-'));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, 'assets'));
copyFileSync(new URL('../test/fixtures/rubik-subset.woff2', import.meta.url).pathname, join(dir, 'assets/sub.woff2'));
const store = new Store(':memory:');
store.insertAsset({ id: 'logo-a', kind: 'logo', name: 'A', ext: 'png', bytes: 1, sha256: '', meta: {} });
store.insertAsset({ id: 'sub', kind: 'font', name: 'Sub', ext: 'woff2', bytes: 1, sha256: '', meta: {} });
const env = { specDir: dir, store };

const base = () => ({
  id: 'v',
  language: 'en',
  contentType: 'event',
  sections: [
    { role: 'title', text: 'Open *Mic*' },
    { role: 'datetime', date: '2026-12-04', time: '20:00' },
    { role: 'endcard', logos: ['logo-a'] },
  ] as Record<string, unknown>[],
  style: 'kinetic-quote' as unknown,
  palette: 'flamingo-cafe',
  fonts: { display: 'rubik' } as Record<string, string>,
  music: { source: 'preset', preset: 'lofi-jazz', bpm: 100, seed: 1 },
  duration: 14,
  formats: ['9:16'],
});

test('a renderable draft: ok, timing per section, contrast rows', async () => {
  const v = await validateSpec(base(), env);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.ok(v.timing?.ok);
  if (v.timing?.ok) {
    assert.equal(v.timing.bpm, 100);
    assert.deepEqual(v.timing.sections.map((s) => s.id), ['title-0', 'datetime-1', 'endcard-2']);
  }
  assert.ok(v.contrast.some((c) => c.palette === 'flamingo-cafe' && c.color === '#1B2A4A' && c.ratio > 10));
  // flamingo-cafe has pastel accents below 3:1 → warnings, not errors
  assert.ok(v.issues.every((i) => i.level === 'warn' && i.path[0] === 'palette'));
  assert.deepEqual(v.missingGlyphs, []);
});

test('schema issues map to JSON paths', async () => {
  const s = base();
  s.sections[0] = { role: 'title', text: '' };
  const v = await validateSpec(s, env);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.level === 'error' && i.path.join('.') === 'sections.0.text'), JSON.stringify(v.issues));
  assert.equal(v.timing, undefined);
});

test('missing assets point at the reference', async () => {
  const s = base();
  s.sections[2] = { role: 'endcard', logos: ['logo-a', 'ghost'] };
  const v = await validateSpec(s, env);
  assert.equal(v.ok, false);
  assert.deepEqual(v.issues.find((i) => i.level === 'error')?.path, ['sections', 2, 'logos', 1]);
});

test('timing overflow reports the needed duration', async () => {
  const s = base();
  s.duration = 6;
  s.sections.splice(1, 0, ...['one two three four', 'five six seven eight', 'nine ten eleven twelve'].map((text) => ({ role: 'body', text })));
  const v = await validateSpec(s, env);
  assert.equal(v.ok, false);
  assert.ok(v.timing && !v.timing.ok);
  if (v.timing && !v.timing.ok) {
    assert.equal(v.timing.available, 6);
    assert.ok(v.timing.needed > 6);
  }
  assert.ok(v.issues.some((i) => i.path[0] === 'duration' && i.level === 'error'));
});

test('style diagnostics: unknown style is an error on `style`', async () => {
  const s = base();
  s.style = 'no-such-style';
  const v = await validateSpec(s, env);
  assert.equal(v.ok, false);
  assert.ok(v.style.some((d) => d.level === 'error' && /unknown style/.test(d.message)));
  assert.ok(v.issues.some((i) => i.path[0] === 'style'));
});

test('too many words per section is a warning on the text', async () => {
  const s = base();
  s.sections.splice(1, 0, { role: 'body', text: 'one two three four five six seven eight' });
  const v = await validateSpec(s, env);
  assert.ok(v.issues.some((i) => i.level === 'warn' && i.path.join('.') === 'sections.1.text'));
});

test('missing glyphs of an uploaded font (letters-only subset cannot draw digits)', async () => {
  const s = base();
  s.fonts = { display: 'sub', text: 'rubik' };
  const v = await validateSpec(s, env);
  assert.equal(v.ok, false);
  const m = v.missingGlyphs.find((g) => g.font === 'sub');
  assert.ok(m && m.chars.includes('2') && m.chars.includes(':'), JSON.stringify(v.missingGlyphs));
  assert.ok(!v.missingGlyphs.some((g) => g.font === 'rubik'));
  assert.ok(v.issues.some((i) => i.path.join('.') === 'fonts.display' && i.level === 'error'));
  const unknown = await validateSpec({ ...base(), fonts: { display: 'nope' } }, env);
  assert.ok(unknown.issues.some((i) => i.path.join('.') === 'fonts.display' && /neither/.test(i.message)));
});
