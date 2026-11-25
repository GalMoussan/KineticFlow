import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { SoundCue } from '@reel/core';
import { SOUND_KINDS } from '@reel/core';
import { dilemma, dilemmaSheet, sheetSoundCues } from '../dev/fixtures.ts';
import { loadSampleBank } from '../dev/samples.ts';
import {
  MAX_CREST_DB,
  MUSIC_PRESETS,
  PRESET_BPM,
  PRESET_DEFAULT_BPM,
  PRESET_INFO,
  SAMPLE_MANIFEST,
  ScoreError,
  decodeWav,
  encodeWav,
  limit,
  loudness,
  truePeak,
  master,
  mix,
  musicArrangement,
  renderArrangement,
  renderMusic,
  renderSfx,
  synthesize,
  type Stereo,
} from './index.ts';
import { kitSample } from './samples.ts';
import { computeEnvelopes } from './envelope.ts';

const SR = 48000;
const bank = await loadSampleBank();
const sheet = dilemmaSheet(100);
if (dilemma.music.source !== 'preset') throw new Error('dilemma must use a preset');
const music = { preset: dilemma.music.preset, bpm: dilemma.music.bpm, seed: dilemma.music.seed };

const hash = (x: Stereo) =>
  createHash('sha256').update(new Uint8Array(x.l.buffer, x.l.byteOffset, x.l.byteLength)).update(new Uint8Array(x.r.buffer, x.r.byteOffset, x.r.byteLength)).digest('hex');
const peak = (x: Stereo) => {
  let p = 0;
  for (let i = 0; i < x.l.length; i++) p = Math.max(p, Math.abs(x.l[i]!), Math.abs(x.r[i]!));
  return p;
};
const energy = (x: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) e += x[i]! * x[i]!;
  return e;
};

test('at least ten presets with catalog metadata; unknown presets are rejected', () => {
  assert.deepEqual(MUSIC_PRESETS, [
    'lofi-jazz',
    'synthwave-drive',
    'minimal-pop',
    'house-128',
    'trap-808',
    'cinematic-pulse',
    'chiptune',
    'acoustic-folk',
    'ambient-drift',
    'funk-disco',
  ]);
  assert.deepEqual(PRESET_INFO.map((p) => p.id), MUSIC_PRESETS);
  assert.equal(new Set(PRESET_INFO.map((p) => p.name)).size, PRESET_INFO.length);
  for (const p of PRESET_INFO) {
    assert.ok(p.bpm[0] >= 60 && p.bpm[1] <= 180 && p.bpm[0] < p.bpm[1], `${p.id}: range ${p.bpm}`);
    assert.ok(p.defaultBpm >= p.bpm[0] && p.defaultBpm <= p.bpm[1], `${p.id}: default ${p.defaultBpm}`);
    assert.ok(p.description.length > 5 && p.description.length <= 48, `${p.id}: "${p.description}"`);
  }
  assert.throws(() => renderMusic(sheet, { ...music, preset: 'polka' }, { samples: bank }), /lofi-jazz/);
});

for (const id of MUSIC_PRESETS) {
  const bpm = Math.round((PRESET_BPM[id]![0] + PRESET_BPM[id]![1]) / 2);
  const s = dilemmaSheet(bpm);
  const m = { preset: id, bpm, seed: 1101 };

  test(`${id}: deterministic, exact length, seed-dependent, renders 26 s in < 3 s`, () => {
    renderMusic(s, m, { samples: bank }); // warm
    const t = performance.now();
    const a = renderMusic(s, m, { samples: bank });
    const ms = performance.now() - t;
    const b = renderMusic(s, m, { samples: bank });
    assert.equal(a.l.length, Math.round(s.duration * SR));
    assert.equal(a.r.length, a.l.length);
    assert.equal(a.sampleRate, SR);
    assert.equal(hash(a), hash(b));
    assert.notEqual(hash(renderMusic(s, { ...m, seed: 7 }, { samples: bank })), hash(a), 'seed changes the render');
    assert.ok(a.notes > 100, `${a.notes} events`);
    assert.ok(ms < 3000, `render took ${ms.toFixed(0)} ms`);
  });

  test(`${id}: every landing has a hit within 1 ms at the low, mid and high tempo of its range`, () => {
    const [lo, hi] = PRESET_BPM[id]!;
    for (const tempo of [lo, (lo + hi) / 2, hi]) {
      const sh = dilemmaSheet(tempo);
      const a = musicArrangement(sh, { preset: id, bpm: tempo, seed: 3 });
      const hits = a.events.filter((e) => e.tag === 'land').map((e) => e.t);
      const lands = sh.cues.filter((c) => c.type === 'land');
      assert.ok(lands.length > 20);
      for (const c of lands) assert.ok(hits.some((t) => Math.abs(t - c.t) <= 0.001), `${id}@${tempo}: no hit at ${c.t}`);
      for (const e of a.events) assert.ok(e.t >= 0 && e.t < sh.duration, `${id}@${tempo}: event at ${e.t}`);
    }
  });

  test(`${id}: the ending resolves and fades to silence by the duration`, () => {
    const a = renderMusic(s, m, { samples: bank });
    const n = a.l.length;
    const tail = Math.max(peak({ l: a.l.subarray(n - 480), r: a.r.subarray(n - 480), sampleRate: SR }));
    assert.ok(tail < 0.01 * peak(a), `last 10 ms peak ${tail}`);
    const end = musicArrangement(s, m).fade!;
    assert.equal(end.to, s.duration);
    assert.ok(energy(a.l, Math.round(end.from * SR) - 4800, Math.round(end.from * SR)) > 0, 'a chord sounds before the fade');
  });
}

test('lofi-jazz: each landing pluck starts on its exact sample (onset within 1 ms)', () => {
  const { fade: _fade, rmsDb: _rms, glue: _glue, ...a } = musicArrangement(sheet, music);
  const lands = a.events.filter((e) => e.tag === 'land');
  for (const e of lands) {
    const one = renderArrangement({ ...a, duration: e.t + 0.02, events: [e] }, { sampleRate: SR, seed: 1, sample: (id) => kitSample(bank, id) });
    const s = Math.round(e.t * SR);
    let first = -1;
    for (let i = 0; i < one.l.length; i++) {
      if (one.l[i] !== 0 || one.r[i] !== 0) {
        first = i;
        break;
      }
    }
    // Nothing before the landing; the first non-zero sample within 2 samples (a sine starts at phase 0).
    assert.ok(first >= s && first - s <= 2, `pluck for ${e.t} starts at sample ${first}, expected ${s}`);
    assert.ok(energy(one.l, s, s + 48) > 1e-6, `pluck at ${e.t} has energy in its first ms`);
  }
});

/** Demo tempo per preset: its studio default (as dev/render-presets.ts). */
const DEMO_BPM = PRESET_DEFAULT_BPM;

for (const id of MUSIC_PRESETS) {
  test(`${id}: the sub band (< 60 Hz) peaks on the kicks (kick frames ≥ 1.5× the rest)`, () => {
    const bpm = DEMO_BPM[id]!;
    const s = dilemmaSheet(bpm);
    const m = { preset: id, bpm, seed: 1101 };
    const kicks = [...new Set(musicArrangement(s, m).events.filter((e) => e.tag === 'kick').map((e) => e.t))].sort((a, b) => a - b);
    assert.ok(kicks.length > 10, `${kicks.length} kicks`);
    const sub = computeEnvelopes(renderMusic(s, m, { samples: bank }), s.fps, s.frames).sub;
    // Kick frames: the frame the kick lands in through the frame holding t + 100 ms (the boom's body).
    const kickFrames = new Set<number>();
    for (const t of kicks) for (let f = Math.floor(t * s.fps); f <= Math.floor((t + 0.1) * s.fps); f++) kickFrames.add(f);
    let on = 0;
    let onN = 0;
    let off = 0;
    let offN = 0;
    for (let f = Math.floor(kicks[0]! * s.fps); f < Math.floor(kicks.at(-1)! * s.fps); f++) {
      if (kickFrames.has(f)) {
        on += sub[f]!;
        onN++;
      } else {
        off += sub[f]!;
        offN++;
      }
    }
    const ratio = on / onN / (off / offN);
    assert.ok(ratio >= 1.5, `${id}: mean sub on kick frames / elsewhere = ${ratio.toFixed(2)}`);
  });
}

test('master: music + SFX of every preset leaves true peak − integrated loudness ≤ MAX_CREST_DB', () => {
  for (const id of MUSIC_PRESETS) {
    const s = dilemmaSheet(DEMO_BPM[id]!);
    const m = renderMusic(s, { preset: id, bpm: DEMO_BPM[id]!, seed: 1101 }, { samples: bank });
    const sfx = renderSfx(sheetSoundCues(s), { duration: s.duration, seed: 1101, samples: bank });
    const x = master(mix([{ audio: m, gain: 1 }, { audio: sfx, gain: 1 }], s.duration));
    const crest = 20 * Math.log10(truePeak(x.l, x.r)) - loudness(x.l, x.r, SR);
    assert.ok(crest <= MAX_CREST_DB + 0.05, `${id}: crest ${crest.toFixed(2)} dB`);
  }
});

test('master: peak ≤ 0.95, silence stays silent, mix sums in order with exact length', () => {
  const m = renderMusic(sheet, music, { samples: bank });
  const sfx = renderSfx(sheetSoundCues(sheet), { duration: 26, seed: 1101, samples: bank });
  const x = master(mix([{ audio: m, gain: 1 }, { audio: sfx, gain: 1 }], 26));
  assert.equal(x.l.length, 26 * SR);
  const p = peak(x);
  assert.ok(p <= 0.95 && p > 0.9, `peak ${p}`);
  const quiet = master(mix([{ audio: { l: new Float32Array(10), r: new Float32Array(10), sampleRate: SR }, gain: 1 }], 1));
  assert.equal(quiet.l.length, SR);
  assert.equal(peak(quiet), 0);
  const short = mix([{ audio: m, gain: 0.5 }], 1.2345);
  assert.equal(short.l.length, Math.round(1.2345 * SR));
  assert.equal(short.l[1000], Math.fround(m.l[1000]! * 0.5));
});

test('SFX: deterministic, exact length, and nothing before the first cue', () => {
  const cues = sheetSoundCues(sheet);
  const a = renderSfx(cues, { duration: 26, seed: 1101, samples: bank });
  const b = renderSfx(cues, { duration: 26, seed: 1101, samples: bank });
  assert.equal(hash(a), hash(b));
  assert.equal(a.l.length, 26 * SR);
  const odd = renderSfx(cues, { duration: 7.777, seed: 1, samples: bank });
  assert.equal(odd.l.length, Math.round(7.777 * SR));
  assert.equal(energy(a.l, 0, Math.round(cues[0]!.t * SR)) + energy(a.r, 0, Math.round(cues[0]!.t * SR)), 0);
});

test('SFX: every kind starts exactly at t (±1 sample) with nothing before, and has a designed sound', () => {
  const t = 0.4321;
  const s = Math.round(t * SR);
  for (const kind of SOUND_KINDS) {
    const cue: SoundCue = { t, kind, weight: 1, ...(kind === 'whoosh' || kind === 'riser' || kind === 'swipe' || kind === 'scribble' ? { until: t + 0.5 } : {}) };
    const x = renderSfx([cue], { duration: 2, seed: 5, samples: bank });
    let first = -1;
    for (let i = 0; i < x.l.length; i++) {
      if (x.l[i] !== 0 || x.r[i] !== 0) {
        first = i;
        break;
      }
    }
    assert.ok(Math.abs(first - s) <= 1, `${kind}: first sample ${first}, expected ${s}`);
    assert.ok(peak(x) > 0.01, `${kind}: peak ${peak(x)}`);
  }
});

test('SFX: weight maps to gain, pan is respected, repeats vary by cue index', () => {
  const one = (c: Partial<SoundCue>) => renderSfx([{ t: 0.1, kind: 'pop', weight: 1, ...c }], { duration: 1, seed: 9, samples: bank });
  const loud = peak(one({ weight: 1 }));
  const soft = peak(one({ weight: 0.25 }));
  assert.ok(soft < loud * 0.2 && soft > 0, `${soft} vs ${loud}`);
  assert.equal(peak(one({ weight: 0 })), 0);
  const left = one({ pan: -1 });
  assert.ok(energy(left.l, 0, SR) > 20 * energy(left.r, 0, SR), 'pan −1 is left');
  const twice = renderSfx(
    [
      { t: 0.1, kind: 'impact', weight: 1 },
      { t: 1.1, kind: 'impact', weight: 1 },
    ],
    { duration: 2, seed: 9, samples: bank },
  );
  let same = true;
  for (let i = 0; i < 20000 && same; i++) same = twice.l[4800 + i] === twice.l[52800 + i];
  assert.ok(!same, 'two identical cues render differently');
});

test('sample manifest: CC0, pinned, unique ids, every file decodes to 48 kHz and every used id exists', () => {
  const ids = new Set(SAMPLE_MANIFEST.map((e) => e.id));
  assert.equal(ids.size, SAMPLE_MANIFEST.length);
  assert.ok(SAMPLE_MANIFEST.length >= 20 && SAMPLE_MANIFEST.length <= 30);
  for (const e of SAMPLE_MANIFEST) {
    assert.equal(e.license, 'CC0-1.0');
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    assert.match(e.url, /^https:\/\/raw\.githubusercontent\.com\/stargatedaw\/stargate-sample-pack\/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027\//);
    const s = kitSample(bank, e.id);
    assert.equal(s.sampleRate, SR);
    assert.ok(s.l.length > 1000 && peak(s) > 0.05, e.id);
  }
  const used = new Set<string>();
  for (const id of MUSIC_PRESETS) for (const ev of musicArrangement(sheet, { preset: id, bpm: 110, seed: 1 }).events) if (ev.v === 'sample') used.add(ev.id);
  for (const id of used) assert.ok(ids.has(id), `${id} is not in the manifest`);
});

/** RIFF/WAVE bytes for tests. */
function wavBytes(o: { format: number; bits: number; channels: number; rate: number; frames: number; extensible?: boolean; write: (v: DataView, o: number, x: number) => void; signal: (i: number, ch: number) => number }): Uint8Array {
  const width = o.bits / 8;
  const fmtSize = o.extensible ? 40 : 16;
  const data = o.frames * o.channels * width;
  const buf = new Uint8Array(12 + 8 + fmtSize + 8 + data);
  const v = new DataView(buf.buffer);
  const tag = (p: number, s: string) => [...s].forEach((c, i) => (buf[p + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, buf.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, fmtSize, true);
  v.setUint16(20, o.extensible ? 0xfffe : o.format, true);
  v.setUint16(22, o.channels, true);
  v.setUint32(24, o.rate, true);
  v.setUint32(28, o.rate * o.channels * width, true);
  v.setUint16(32, o.channels * width, true);
  v.setUint16(34, o.bits, true);
  if (o.extensible) {
    v.setUint16(36, 22, true);
    v.setUint16(38, o.bits, true);
    v.setUint32(40, 3, true);
    v.setUint16(44, o.format, true);
  }
  const d = 20 + fmtSize;
  tag(d, 'data');
  v.setUint32(d + 4, data, true);
  for (let i = 0, p = d + 8; i < o.frames; i++) for (let ch = 0; ch < o.channels; ch++, p += width) o.write(v, p, o.signal(i, ch));
  return buf;
}

test('decodeWav: PCM16/24/32f, extensible, mono → stereo, resampling to 48 kHz', () => {
  const sig = (i: number, ch: number) => (ch ? -0.5 : 0.5) * ((i % 50) / 50);
  const i16 = (v: DataView, o: number, x: number) => v.setInt16(o, Math.round(x * 32767), true);
  const i24 = (v: DataView, o: number, x: number) => {
    const n = Math.round(x * 8388607);
    v.setUint8(o, n & 0xff);
    v.setUint8(o + 1, (n >> 8) & 0xff);
    v.setUint8(o + 2, (n >> 16) & 0xff);
  };
  const f32 = (v: DataView, o: number, x: number) => v.setFloat32(o, x, true);
  for (const [format, bits, write, tol] of [
    [1, 16, i16, 1 / 32767],
    [1, 24, i24, 1 / 8388607],
    [3, 32, f32, 0],
  ] as const) {
    for (const extensible of [false, true]) {
      const x = decodeWav(wavBytes({ format, bits, channels: 2, rate: SR, frames: 1000, extensible, write, signal: sig }));
      assert.equal(x.l.length, 1000);
      for (const i of [0, 7, 499, 999]) {
        assert.ok(Math.abs(x.l[i]! - sig(i, 0)) <= tol + 1e-7, `${bits}-bit L[${i}]`);
        assert.ok(Math.abs(x.r[i]! - sig(i, 1)) <= tol + 1e-7, `${bits}-bit R[${i}]`);
      }
    }
  }
  const mono = decodeWav(wavBytes({ format: 1, bits: 16, channels: 1, rate: SR, frames: 10, write: i16, signal: () => 0.25 }));
  assert.deepEqual([...mono.l], [...mono.r]);
  // 44.1 kHz sine → 48 kHz: length scales exactly and the waveform is preserved away from the edges.
  const sine = (i: number) => Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;
  const rs = decodeWav(wavBytes({ format: 3, bits: 32, channels: 1, rate: 44100, frames: 44100, write: f32, signal: sine }));
  assert.equal(rs.l.length, SR);
  let err = 0;
  for (let j = 1000; j < SR - 1000; j++) err = Math.max(err, Math.abs(rs.l[j]! - Math.sin((2 * Math.PI * 440 * j) / SR) * 0.5));
  assert.ok(err < 2e-3, `resample error ${err}`);
  assert.throws(() => decodeWav(new Uint8Array(40)), /RIFF/);
});

test('encodeWav: 16- and 24-bit headers, exact frames, round trip', () => {
  const x: Stereo = { l: new Float32Array([0, 0.5, -0.5, 1.5]), r: new Float32Array([0.25, -1, 0, -2]), sampleRate: SR };
  for (const bits of [16, 24] as const) {
    const w = encodeWav(x, bits);
    const v = new DataView(w.buffer);
    assert.equal(w.byteLength, 44 + 4 * 2 * (bits / 8));
    assert.equal(v.getUint16(34, true), bits);
    assert.equal(v.getUint32(24, true), SR);
    const y = decodeWav(w);
    assert.ok(Math.abs(y.l[1]! - 0.5) < 1e-4 && Math.abs(y.r[1]! + 1) < 1e-4);
    assert.ok(y.l[3]! <= 1 && y.r[3]! >= -1, 'clipped');
  }
});

test('bus limiter keeps every sample under ceiling · input peak', () => {
  const m = renderMusic(sheet, music, { samples: bank });
  const l = Float64Array.from(m.l);
  const r = Float64Array.from(m.r);
  const before = peak(m);
  limit(l, r, SR, { ceiling: 0.6, lookahead: 0.005, release: 0.15 });
  let after = 0;
  for (let i = 0; i < l.length; i++) after = Math.max(after, Math.abs(l[i]!), Math.abs(r[i]!));
  assert.ok(after <= before * 0.6 + 1e-12, `${after} > ${before * 0.6}`);
  assert.ok(after > before * 0.55, 'limiter should not over-attenuate');
});

test('the OpenKatana note synthesiser stays deterministic and validated', () => {
  const doc = { duration: 1, seed: 3, notes: [{ at: 0, duration: 0.5, waveform: 'bell' as const, midi: 72 }, { at: 0.2, duration: 0.5, waveform: 'noise' as const }] };
  const a = synthesize(doc);
  const b = synthesize(doc);
  assert.deepEqual(a.mix, b.mix);
  assert.ok(a.peak <= 0.95);
  assert.throws(() => synthesize({ duration: 1, notes: [{ at: 0.9, duration: 0.2 }] }), ScoreError);
});
