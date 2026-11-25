/**
 * P0 spike S1. Run: node --test packages/render/dev/sketch/SketchLLM-prompt.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SketchDoc } from './doc.ts';
import { encodeStrokes, parseResponse, schema, systemPrompt, tokenProxy } from './SketchLLM-prompt.ts';

const meta: SketchDoc['meta'] = { source: 'llm', detail: 1, seed: 1, version: 'test' };

test('strings encoding parses, tolerates extra spaces and semicolons', () => {
  const p = parseResponse(
    { plan: 'box', strokes: ['10,10 90,10  90,90; 10,90 10,10', '20,20 80,80', '0,0 5,5', '1,1 2,2', '3,3 4,4', '6,6 7,7'] },
    { encoding: 'strings', mode: 'sketch', detail: 1, meta },
  );
  assert.deepEqual(p.issues, []);
  assert.equal(p.countInRange, true);
  assert.deepEqual(p.doc!.strokes[0]!.pts, [
    [10, 10],
    [90, 10],
    [90, 90],
    [10, 90],
    [10, 10],
  ]);
});

test('nested encoding parses the same geometry', () => {
  const p = parseResponse({ plan: 'x', strokes: [[[10, 10], [90, 10]]] }, { encoding: 'nested', mode: 'sketch', detail: 1, meta });
  assert.deepEqual(p.doc!.strokes[0]!.pts, [
    [10, 10],
    [90, 10],
  ]);
  assert.equal(p.countInRange, false);
});

test('problems are reported, not thrown', () => {
  const p = parseResponse(
    { strokes: ['10,10 x,4 1200,5.5', [[1, 2]], 42] },
    { encoding: 'strings', mode: 'line', detail: 1, meta },
  );
  assert.ok(p.issues.includes('2 strokes not in the strings encoding'));
  assert.ok(p.issues.some((i) => i.includes('unreadable points')));
  assert.ok(p.issues.includes('no plan'));
  assert.ok(p.issues.includes('1 points outside 0..1000'));
  assert.ok(p.issues.includes('1 non-integer points'));
  assert.ok(p.issues.includes('line mode has 2 strokes'));
  assert.equal(parseResponse('nope', { encoding: 'strings', mode: 'line', detail: 1, meta }).doc, null);
});

test('the strings encoding is the shorter one', () => {
  const doc: SketchDoc = { v: 1, box: [1000, 1000], mode: 'sketch', strokes: [{ pts: [[100, 200], [300, 400], [500, 600]] }], meta };
  assert.equal(encodeStrokes(doc, 'strings'), '["100,200 300,400 500,600"]');
  assert.equal(encodeStrokes(doc, 'nested'), '[[[100,200],[300,400],[500,600]]]');
  assert.ok(tokenProxy(encodeStrokes(doc, 'strings')) < tokenProxy(encodeStrokes(doc, 'nested')));
});

test('prompt and schema follow mode, detail and encoding', () => {
  assert.match(systemPrompt('sketch', 3, 'strings'), /18–28 strokes/);
  assert.match(systemPrompt('line', 5, 'nested'), /exactly ONE stroke.*400–600 points/);
  assert.equal(schema('strings').properties!.strokes!.items!.type, 'string');
  assert.equal(schema('nested').properties!.strokes!.items!.items!.type, 'array');
});
