import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JobSpec } from '@reel/core';
import { recipe } from '@reel/styles';
import { buildCueSheet, TimingError, trimEdgeBeats } from './index.ts';

const example = JSON.parse(readFileSync(new URL('../../../examples/dilemma.json', import.meta.url), 'utf8'));
const choreography = recipe('kinetic-quote').choreography;
const sheet = buildCueSheet({ spec: JobSpec.parse(example), choreography, bpm: 100, fps: 30 });
const H = 0.3; // half-beat at 100 bpm

test('every landing sits on the half-beat grid and inside its section window', () => {
  for (const s of sheet.sections) {
    for (const it of s.items) {
      const h = (it.at - 0.5) / H;
      assert.ok(Math.abs(h - Math.round(h)) < 1e-6, `${it.text} at ${it.at} is off-grid`);
      assert.ok(it.at >= s.timing.in && it.at <= s.timing.out, `${it.text} outside ${s.id}`);
    }
  }
});

test('sections are ordered, non-overlapping, and the end card holds ≥ endHold to the end', () => {
  const ss = sheet.sections;
  for (let i = 1; i < ss.length; i++) assert.ok(ss[i]!.timing.in >= ss[i - 1]!.timing.out);
  const end = ss.at(-1)!;
  assert.equal(end.role, 'endcard');
  assert.equal(end.timing.out, 26);
  const outro = sheet.cues.find((c) => c.type === 'outro')!;
  assert.ok(26 - outro.t >= choreography.endHold - 1e-9);
  assert.equal(sheet.frames, 780);
});

test('content items come from the spec: derived weekday, emphasis, LTR numbers, logos', () => {
  const dt = sheet.sections.find((s) => s.role === 'datetime')!;
  assert.deepEqual(
    dt.items.map((i) => [i.text, i.ltr]),
    [['יום שלישי', false], ['01.12', true], ['19:30', true]],
  );
  const tag = sheet.sections.find((s) => s.role === 'tagline')!;
  assert.deepEqual(tag.items.filter((i) => i.emphasis).map((i) => i.text), ['מעניינים', 'וחמים']);
  const loc = sheet.sections.find((s) => s.role === 'location')!;
  assert.deepEqual(loc.items.map((i) => i.text), ['בית', 'החאן,', 'קרית שמונה']);
  const end = sheet.sections.at(-1)!;
  assert.deepEqual(end.items.map((i) => i.kind), ['word', 'word', 'word', 'logos']);
});

test('a short word takes the off-beat and the next word returns to the beat', () => {
  const tag = sheet.sections.find((s) => s.role === 'tagline')!.items;
  const [a, b, c] = tag.map((i) => i.at);
  assert.ok(Math.abs(b! - a! - H) < 1e-9 && Math.abs(c! - a! - 2 * H) < 1e-9);
});

test('too much text for the duration is a TimingError naming the needed length', () => {
  const long = { ...example, duration: 12 };
  assert.throws(
    () => buildCueSheet({ spec: JobSpec.parse(long), choreography, bpm: 100, fps: 30 }),
    (e: unknown) => e instanceof TimingError && e.needed > 12 && e.needed < 26,
  );
});

test('changing only the date leaves every time unchanged', () => {
  const moved = structuredClone(example);
  moved.sections[4].date = '2026-12-03';
  const other = buildCueSheet({ spec: JobSpec.parse(moved), choreography, bpm: 100, fps: 30 });
  assert.deepEqual(other.cues, sheet.cues);
  assert.equal(other.sections[4]!.items[0]!.text, 'יום חמישי');
});

// ───────────────────────────── uniform grid regression ─────────────────────────────

test('the uniform grid is bit-identical to the M2 engine (dilemma sheet and the test set × M2 styles × fps)', async () => {
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  assert.equal(JSON.stringify(sheet) + '\n', fixture('dilemma-cues.json'));
  // `<test-set file>|<style>|<fps>` → sha256 of the sheet JSON, captured from the M2 engine
  const hashes = JSON.parse(fixture('uniform-grid-hashes.json')) as Record<string, string>;
  const dir = new URL('../../../examples/test-set/', import.meta.url);
  for (const [key, want] of Object.entries(hashes)) {
    const [f, id, fps] = key.split('|') as [string, string, string];
    const spec = JobSpec.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    const bpm = spec.music.source === 'preset' ? spec.music.bpm : recipe(id).defaults.music.bpm;
    const s = buildCueSheet({ spec, choreography: recipe(id).choreography, bpm, fps: Number(fps) });
    assert.equal(createHash('sha256').update(JSON.stringify(s)).digest('hex'), want, key);
  }
  assert.equal(Object.keys(hashes).length, 30);
});

// ───────────────────────────── detected grids ─────────────────────────────

/** Accelerating 96 → 132 bpm with ±8 ms jitter (seeded), 4/4 downbeats from the second beat. */
function driftingGrid(duration = 27) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const beats: number[] = [];
  for (let t = 0.21; t < duration; ) {
    beats.push(Math.round((t + rnd() * 0.008) * 1e4) / 1e4);
    const bpm = 96 + (36 * t) / duration;
    t += 60 / bpm;
  }
  return { beats, downbeats: beats.filter((_, i) => i % 4 === 1) };
}

/** Detected beats plus the midpoints of consecutive beats. */
const slots = (beats: number[]) => [...beats, ...beats.slice(1).map((b, i) => (beats[i]! + b) / 2)];

test('on a drifting detected grid every landing sits on a detected beat or half-beat', () => {
  const grid = driftingGrid();
  const s = buildCueSheet({ spec: JobSpec.parse(example), choreography, fps: 30, grid: { ...grid, meterConfidence: 1 } });
  const all = slots(grid.beats);
  const lands = s.cues.filter((c) => c.type === 'land');
  assert.ok(lands.length > 20);
  for (const c of lands) {
    const err = Math.min(...all.map((b) => Math.abs(b - c.t)));
    assert.ok(err < 1e-6, `land ${c.section}#${c.unit} at ${c.t} is ${err} s off the detected grid`);
  }
  // first landing beat is the first trusted downbeat ≥ MIN_GRID_T0
  assert.equal(s.t0, grid.downbeats.find((d) => d >= 0.4));
  for (let i = 1; i < s.sections.length; i++) assert.ok(s.sections[i]!.timing.in >= s.sections[i - 1]!.timing.out);
  // non-last sections keep ≥ minTail after their last landing; the end card ≥ endHold
  for (const sec of s.sections.slice(0, -1)) assert.ok(sec.timing.out - sec.timing.lastLand >= choreography.minTail - 1e-6);
  const outro = s.cues.find((c) => c.type === 'outro')!;
  assert.ok(26 - outro.t >= choreography.endHold - 1e-6);
  // bpm is the median detected tempo; beats/downbeats are the detected ones inside the video
  const ibis = grid.beats.slice(1).map((b, i) => b - grid.beats[i]!).sort((a, b) => a - b);
  const m = ibis.length;
  const median = m % 2 ? ibis[(m - 1) / 2]! : (ibis[m / 2 - 1]! + ibis[m / 2]!) / 2;
  assert.ok(Math.abs(s.bpm! - 60 / median) < 1e-5);
  assert.deepEqual(s.beats, grid.beats.filter((b) => b < 26));
  assert.deepEqual(s.downbeats, grid.downbeats.filter((b) => b < 26));
  // a unit of 1 beat is one local beat: consecutive regular title words are one detected beat apart
  const title = s.sections[0]!.items.map((i) => i.at);
  for (let k = 1; k < title.length; k++) {
    const i = grid.beats.indexOf(title[k - 1]!);
    assert.ok(i >= 0 && grid.beats[i + 1] === title[k], `title word ${k} is not on the next detected beat`);
  }
});

test('downbeats with meter confidence < 0.8 are ignored: bars count 4 beats from the first beat ≥ MIN_GRID_T0', () => {
  const grid = driftingGrid();
  const s = buildCueSheet({ spec: JobSpec.parse(example), choreography, fps: 30, grid: { ...grid, meterConfidence: 0.5 } });
  const first = grid.beats.findIndex((b) => b >= 0.4);
  assert.equal(s.t0, grid.beats[first]);
  assert.deepEqual(s.downbeats, grid.beats.filter((b, i) => i >= first && (i - first) % 4 === 0 && b < 26));
});

test('a track too slow for the text is a TimingError naming the needed length and the detected tempo', () => {
  const beats = Array.from({ length: 30 }, (_, i) => 0.5 + i * 0.9);
  assert.throws(
    () => buildCueSheet({ spec: JobSpec.parse(example), choreography, fps: 30, grid: { beats, downbeats: [] } }),
    (e: unknown) => e instanceof TimingError && e.needed > 26 && /track's 66\.6+7 bpm/.test(e.message),
  );
});

test('trimEdgeBeats drops weak beats at the edges only', async () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
  // median 0.5 → threshold 0.1: the weak inner beat (0.02 at 1.5 s) stays
  const strength = [0.05, 0.8, 0.9, 0.02, 0.7, 0.85, 0.6, 0.5, 0.08, 0.01];
  const r = trimEdgeBeats({ beats, downbeats: [0, 2, 4.5] }, strength);
  assert.deepEqual(r.grid.beats, [0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(r.grid.downbeats, [2]);
  assert.deepEqual([r.head, r.tail], [1, 2]);
});
