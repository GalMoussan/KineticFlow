/**
 * Listening deliverables (M3): every preset on the dilemma cue sheet, an SFX demo, and the M1-vs-M3 lofi comparison,
 * as MP3s in out/dev/audio/. Each file goes through the production chain (stems → mix → master → two-pass linear
 * loudnorm to −14 LUFS / −1.5 dBTP). Prints render times, CPU time of renderSfx, and the loudness of every master.
 *   node packages/audio/dev/render-presets.ts
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SoundCue } from '@reel/core';
import { MUSIC_PRESETS, PRESET_BPM, encodeWav, master, mix, renderMusic, renderSfx, synthesize, type Stereo } from '../src/index.ts';
import { dilemma, dilemmaSheet, sheetSoundCues } from './fixtures.ts';
import { lofiJazz as lofiM1 } from './lofi-m1.ts';
import { loadSampleBank } from './samples.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = `${root}out/dev/audio`;
mkdirSync(dir, { recursive: true });
const bank = await loadSampleBank();

/** Tempo each preset is demoed at (the dilemma spec's own 100 for lofi-jazz). */
const DEMO_BPM: Record<string, number> = { 'lofi-jazz': 100, 'synthwave-drive': 120, 'minimal-pop': 120, 'house-128': 124 };

interface Ebur {
  lufs: number;
  truePeak: number;
}

function ebur(path: string): Ebur {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(s)?.[1]), truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(s)?.[1]) };
}

/** WAV → two-pass linear loudnorm (like @reel/render) → MP3. Returns the master's and the delivered loudness. */
function deliver(x: Stereo, name: string): { master: Ebur; mp3: Ebur; normalization: string } {
  const wav = `${dir}/${name}.wav`;
  const mp3 = `${dir}/${name}.mp3`;
  writeFileSync(wav, encodeWav(x, 24));
  const ln = 'loudnorm=I=-14:TP=-1.5:LRA=11';
  const m1 = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', `${ln}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const j = JSON.parse(m1.slice(m1.lastIndexOf('{'), m1.lastIndexOf('}') + 1)) as Record<string, string>;
  const pass2 = `${ln}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=json`;
  const r2 = spawnSync('ffmpeg', ['-y', '-hide_banner', '-i', wav, '-af', `${pass2},aresample=48000`, '-c:a', 'libmp3lame', '-b:a', '256k', mp3], { encoding: 'utf8' }).stderr;
  const j2 = JSON.parse(r2.slice(r2.lastIndexOf('{'), r2.lastIndexOf('}') + 1)) as Record<string, string>;
  const out = { master: ebur(wav), mp3: ebur(mp3), normalization: j2.normalization_type ?? '?' };
  rmSync(wav);
  return out;
}

const rows: Record<string, unknown>[] = [];
for (const id of MUSIC_PRESETS) {
  const bpm = DEMO_BPM[id] ?? PRESET_BPM[id]![0];
  const sheet = dilemmaSheet(bpm);
  const music = { preset: id, bpm, seed: 1101 };
  renderMusic(sheet, music, { samples: bank }); // warm-up (JIT, sample preparation)
  const t = performance.now();
  const m = renderMusic(sheet, music, { samples: bank });
  const ms = performance.now() - t;
  const out = master(mix([{ audio: m, gain: 1 }], sheet.duration));
  const d = deliver(out, `${id}-${bpm}`);
  rows.push({ preset: id, bpm, events: m.notes, renderMs: Math.round(ms), masterLufs: d.master.lufs, masterTruePeak: d.master.truePeak, crestDb: +(d.master.truePeak - d.master.lufs).toFixed(1), mp3Lufs: d.mp3.lufs, mp3TruePeak: d.mp3.truePeak, loudnorm: d.normalization, file: `out/dev/audio/${id}-${bpm}.mp3` });
}

// SFX demo: one of each kind, 1.4 s apart, with lengths where the kind uses them.
const kinds: SoundCue[] = [
  { t: 0.3, kind: 'whoosh', weight: 0.8, until: 1.0, pan: -0.3 },
  { t: 1.7, kind: 'impact', weight: 1 },
  { t: 3.1, kind: 'pop', weight: 0.7, pan: 0.3 },
  ...[0, 1, 2, 3, 4, 5].map((k): SoundCue => ({ t: 4.5 + k * 0.08, kind: 'tick', weight: 0.6, pitch: k, pan: 0.2 })),
  { t: 5.9, kind: 'riser', weight: 0.8, until: 7.2 },
  { t: 7.6, kind: 'shimmer', weight: 0.8, pan: 0.2 },
  { t: 9.0, kind: 'swipe', weight: 0.8, until: 9.4, pan: -0.2 },
  { t: 10.4, kind: 'stinger', weight: 1 },
];
const sfxDemo = renderSfx(kinds, { duration: 13, seed: 7, samples: bank });
const sfxD = deliver(master(sfxDemo), 'sfx-demo');
rows.push({ file: 'out/dev/audio/sfx-demo.mp3', mp3Lufs: sfxD.mp3.lufs, mp3TruePeak: sfxD.mp3.truePeak });

// CPU time of renderSfx on the dilemma cue sheet's cue list (warm).
const sheet100 = dilemmaSheet(100);
const cues = sheetSoundCues(sheet100);
renderSfx(cues, { duration: 26, seed: 1101, samples: bank });
const cpu0 = process.cpuUsage();
const w0 = performance.now();
renderSfx(cues, { duration: 26, seed: 1101, samples: bank });
const cpu = process.cpuUsage(cpu0);
rows.push({ renderSfx: `${cues.length} cues / 26 s`, cpuMs: Math.round((cpu.user + cpu.system) / 1000), wallMs: Math.round(performance.now() - w0) });

// M1 synth lofi, a second of silence, then the M3 engine lofi (same cue sheet, same seed).
if (dilemma.music.source !== 'preset') throw new Error('dilemma must use a preset');
const old = synthesize(lofiM1(sheet100, dilemma.music));
const oldL = new Float32Array(old.samples);
const oldR = new Float32Array(old.samples);
for (let i = 0; i < old.samples; i++) {
  oldL[i] = old.mix[2 * i]!;
  oldR[i] = old.mix[2 * i + 1]!;
}
const oldMaster = master({ l: oldL, r: oldR, sampleRate: 48000 });
const newMaster = master(renderMusic(sheet100, dilemma.music, { samples: bank }));
// Level-match the halves before joining (ffmpeg normalises the whole file afterwards).
const lufsOf = (x: Stereo, name: string) => {
  const p = `${dir}/${name}.wav`;
  writeFileSync(p, encodeWav(x, 24));
  const e = ebur(p);
  rmSync(p);
  return e.lufs;
};
const k = 10 ** ((lufsOf(newMaster, '_new') - lufsOf(oldMaster, '_old')) / 20);
const gap = 48000;
const n = oldL.length + gap + newMaster.l.length;
const joined: Stereo = { l: new Float32Array(n), r: new Float32Array(n), sampleRate: 48000 };
for (let i = 0; i < oldL.length; i++) {
  joined.l[i] = oldMaster.l[i]! * k;
  joined.r[i] = oldMaster.r[i]! * k;
}
joined.l.set(newMaster.l, oldL.length + gap);
joined.r.set(newMaster.r, oldL.length + gap);
const cmp = `${dir}/lofi-old-vs-new.wav`;
writeFileSync(cmp, encodeWav(joined, 24));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', cmp, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '256k', `${dir}/lofi-old-vs-new.mp3`]);
rmSync(cmp);
rows.push({ file: 'out/dev/audio/lofi-old-vs-new.mp3', note: '0–26 s M1 synth, 27–53 s M3 engine' });

for (const r of rows) console.log(JSON.stringify(r));
