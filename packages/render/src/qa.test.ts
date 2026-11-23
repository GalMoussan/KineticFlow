import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateContainer, probe, topLevelAtoms } from './qa.ts';

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
