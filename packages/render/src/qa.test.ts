import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CueSheet } from '@reel/core';
import { gateAudioSync, gateContainer, gateSfx, probe, shortTermLoudness, topLevelAtoms } from './qa.ts';

const dir = mkdtempSync(join(tmpdir(), 'reel-qa-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function tinyMp4(name: string, faststart: boolean): string {
  const out = join(dir, name);
  execFileSync('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=64x32:r=30:d=0.2',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', '0.2', '-vf', 'format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    '-c:v', 'libx264', '-c:a', 'aac', '-shortest',
    ...(faststart ? ['-movflags', '+faststart'] : []),
    out,
  ]);
  return out;
}

test('top-level atoms: faststart puts moov before mdat', async () => {
  const fast = (await topLevelAtoms(tinyMp4('fast.mp4', true))).map((a) => a.type);
  const slow = (await topLevelAtoms(tinyMp4('slow.mp4', false))).map((a) => a.type);
  assert.equal(fast[0], 'ftyp');
  assert.ok(fast.indexOf('moov') < fast.indexOf('mdat'), fast.join(' '));
  assert.ok(slow.indexOf('moov') > slow.indexOf('mdat'), slow.join(' '));
});

test('top-level atoms: sizes tile the file, 64-bit and to-EOF sizes parse', async () => {
  const atoms = await topLevelAtoms(tinyMp4('tile.mp4', true));
  atoms.slice(1).forEach((a, i) => assert.equal(a.offset, atoms[i]!.offset + atoms[i]!.size));

  // ftyp (32-bit size) + free (64-bit largesize) + mdat (size 0 = to end of file)
  const ftyp = Buffer.from('00000010667479706973366d00000200', 'hex');
  const free = Buffer.alloc(24);
  free.writeUInt32BE(1, 0);
  free.write('free', 4, 'latin1');
  free.writeBigUInt64BE(24n, 8);
  const mdat = Buffer.concat([Buffer.from('000000006d646174', 'hex'), Buffer.alloc(5)]);
  const synthetic = join(dir, 'synthetic.mp4');
  writeFileSync(synthetic, Buffer.concat([ftyp, free, mdat]));
  assert.deepEqual(await topLevelAtoms(synthetic), [
    { type: 'ftyp', offset: 0, size: 16 },
    { type: 'free', offset: 16, size: 24 },
    { type: 'mdat', offset: 40, size: 13 },
  ]);

  const broken = join(dir, 'broken.mp4');
  writeFileSync(broken, Buffer.from('000000ff66747970', 'hex'));
  await assert.rejects(topLevelAtoms(broken), /malformed box "ftyp"/);
});

test('container gate fails a non-faststart file and passes a faststart one', async () => {
  const want = { format: '9:16' as const, w: 64, h: 32, fps: 30, frames: 6, audio: true, label: 'mp4' };
  const ok = gateContainer(await probe(tinyMp4('gate-fast.mp4', true)), want);
  assert.equal(ok.level, 'pass', ok.detail);
  const bad = gateContainer(await probe(tinyMp4('gate-slow.mp4', false)), want);
  assert.equal(bad.level, 'fail');
  assert.match(bad.detail, /moov is not before mdat/);
});

// ───────────────────────────── audio-sync, sfx ─────────────────────────────

const sheetWith = (lands: number[]) =>
  ({ fps: 30, cues: lands.map((t, unit) => ({ t, type: 'land', section: 's', unit, weight: 1 })) }) as unknown as CueSheet;

test('audio-sync passes landings on detected beats or half-beats and fails one 2 frames off', () => {
  const beats = [0.5, 0.84, 1.18, 1.5];
  const ok = gateAudioSync(sheetWith([0.5, 0.67, 1.18 + 0.02]), beats);
  assert.equal(ok.level, 'pass', ok.detail);
  assert.match(ok.detail, /3 landings .* max 20\.0 ms, mean 6\.67 ms/);
  const bad = gateAudioSync(sheetWith([0.5, 1.34 + 0.07]), beats);
  assert.equal(bad.level, 'fail');
  assert.match(bad.detail, /1 of 2 landing\(s\) more than 1 frame/);
});

/** 1 s of a sine at `amp` peak in both channels, 48 kHz. */
function sine(hz: number, amp: number, seconds: number) {
  const l = new Float32Array(seconds * 48_000);
  for (let i = 0; i < l.length; i++) l[i] = amp * Math.sin((2 * Math.PI * hz * i) / 48_000);
  return { l, r: l.slice() };
}

test('short-term loudness: a −20 dBFS 997 Hz sine in both channels reads −20 LUFS (BS.1770 K-weighting)', () => {
  const st = shortTermLoudness(sine(997, 0.1, 4));
  assert.ok(Math.abs(st.at(-1)! - -20) < 0.1, `got ${st.at(-1)}`);
});

test('the sfx gate warns when a sound peaks more than 6 dB (LUFS-S) over the music', () => {
  const music = sine(220, 0.05, 6);
  const quiet = sine(2000, 0.05, 6);
  const loud = sine(2000, 0.5, 6);
  const cue = [{ t: 3, kind: 'impact' as const, weight: 1 }];
  assert.equal(gateSfx(music, quiet, cue).level, 'pass');
  const g = gateSfx(music, loud, cue);
  assert.equal(g.level, 'warn');
  assert.match(g.detail, /1 of 1 sound\(s\) more than 6 dB over the music/);
});
