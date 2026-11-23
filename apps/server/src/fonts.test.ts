import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { FONTS } from '@reel/core';
import { FONT_DIR, missingChars, readFont } from '@reel/render';

const FIXTURE = new URL('../test/fixtures/rubik-subset.woff2', import.meta.url).pathname;

for (const [id, f] of Object.entries(FONTS)) {
  const path = join(FONT_DIR, f.file);
  test(`readFont: catalog font ${id} matches the catalog`, { skip: !existsSync(path) && 'run `reelgen setup fonts`' }, () => {
    const info = readFont(readFileSync(path));
    assert.equal(info.family, f.family);
    assert.deepEqual(info.weights, f.weights);
    assert.deepEqual([...info.scripts].sort(), [...f.scripts].sort());
    // variable files carry a wght axis; static ones (one weight) must not claim a range
    assert.ok(f.weights[0] === f.weights[1] ? !info.axes.includes('wght') : info.axes.includes('wght'));
    assert.equal(info.format, 'ttf');
    for (const ch of 'אבגדהוזחטיכלמנסעפצקרשת0123456789:.,') assert.ok(info.codepoints.has(ch.codePointAt(0)!), `${id} has ${ch}`);
  });
}

test('readFont: WOFF2 (Brotli) subset', () => {
  const info = readFont(readFileSync(FIXTURE));
  assert.equal(info.format, 'woff2');
  assert.match(info.family, /^Rubik/);
  assert.deepEqual(info.weights, [300, 900]);
  assert.deepEqual(info.scripts, ['hebrew', 'latin']);
  // the subset holds A–Z, a–z and א–ת only
  assert.equal(info.codepoints.size, 26 + 26 + 27);
  assert.equal(missingChars('שלום world', info.codepoints), '');
  assert.equal(missingChars('19:30 ב-1.12', info.codepoints), '19:30-.2');
});

test('readFont: rejects non-fonts and WOFF 1', () => {
  assert.throws(() => readFont(new TextEncoder().encode('not a font at all')), /not a TTF\/OTF\/WOFF2/);
  assert.throws(() => readFont(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])), /WOFF 1/);
});

test('missingChars ignores whitespace and bidi marks, keeps first-seen order', () => {
  const cps = new Set([...'abc'].map((c) => c.codePointAt(0)!));
  assert.equal(missingChars('a b\u200Fc\u2066 xyx', cps), 'xy');
});
