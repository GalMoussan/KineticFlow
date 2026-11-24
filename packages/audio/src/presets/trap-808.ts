/**
 * trap-808 (130–150 bpm, felt in half time): dark E minor, Em – C – G – D (i–VI–III–VII).
 *
 * - Half-time drums: syncopated kicks from a seeded set of bar patterns, clap + snare on beat 3 of every bar, 8th
 *   hats with trap rolls (16ths, 16th triplets or 32nds, chosen per seed) into every other bar, an open hat on the
 *   "and" of 2 every fourth bar. The first bar is the melody alone.
 * - 808: a driven sine on every kick, gliding from the previous note (seeded), held until the next hit. Its roots sit
 *   at E2–G2 (65–98 Hz) so the kick's boom still owns the band under 60 Hz.
 * - A dark bell melody (8ths, one of three seeded loops) through a ping-pong delay over a low supersaw pad.
 * - Landings: a glass bell on a chord tone; emphasis adds a reversed crash that swells into the hit, a crash and a
 *   boom. Camera moves: a 32nd hat roll and a high-pass sweep into the arrival. The teaser drops the drums and the
 *   808 under a riser.
 * - Ending: a long E 808 with a kick and crash and a rolled Em(add9) bell chord, faded by the end.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

const CHORDS = {
  Em: { root: 40, tones: [64, 67, 71, 74], pad: [52, 55, 59, 62] },
  C: { root: 36, tones: [64, 67, 72, 76], pad: [52, 55, 60, 64] },
  G: { root: 43, tones: [62, 67, 71, 74], pad: [50, 55, 59, 62] },
  D: { root: 38, tones: [62, 66, 69, 74], pad: [50, 54, 57, 62] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Em', 'C', 'G', 'D'];
/** Kick (and 808) positions within a bar, in beats; the clap owns beat 2 (the half-time backbeat). */
const KICKS: readonly (readonly number[])[] = [
  [0, 1.5, 3.5],
  [0, 0.75, 1.5, 3],
  [0, 1.5, 2.5, 3.25],
  [0, 1, 1.75, 3.5],
];
/** Bell loops: chord-tone index per 8th, −1 = rest. */
const MELODIES: readonly (readonly number[])[] = [
  [0, -1, 2, 1, -1, 3, 2, -1],
  [3, 2, -1, 0, -1, 1, 2, -1],
  [0, 1, 2, -1, 3, -1, 2, 1],
];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'Em' : PROG[Math.max(0, p.barAt(t)) % 4]!);
  const drop = (t: number) => p.inTeaser(t);
  const melody = MELODIES[Math.floor(rnd() * MELODIES.length)]!;
  const rolls = [4, 6, 8].map(() => [4, 6, 8][Math.floor(rnd() * 3)]!);

  // Kicks and 808s, bar by bar (the first bar is the melody alone).
  const hits808: { t: number; midi: number }[] = [];
  for (let b = 1; b < p.bars; b++) {
    const pattern = KICKS[(b === 1 ? 0 : Math.floor(rnd() * KICKS.length))]!;
    for (const pos of pattern) {
      const t = p.at(b * 4 + pos);
      if (t >= end - 1e-9) break;
      if (drop(t)) continue;
      kick(ev, t, 'e-kick', 0.85, 0.8, 0.09);
      kicks.push(t);
      const root = CHORDS[chordAt(t)].root;
      // The last hit of every other bar jumps the octave (a classic 808 lift).
      hits808.push({ t, midi: pos === pattern.at(-1) && b % 2 === 1 ? root + 12 : root });
    }
  }
  hits808.forEach((h, i) => {
    const next = hits808[i + 1]?.t ?? end;
    const prev = hits808[i - 1];
    const glide = prev && prev.midi !== h.midi && rnd() < 0.45 ? prev.midi - h.midi : 0;
    const dur = Math.max(0.08, Math.min(next - h.t, bar) - 0.02);
    ev.push({ v: 'sub', bus: 'bass', t: h.t, midi: h.midi, dur, decay: 1.3, release: 0.03, drive: 2.4, gain: 0.5, ...(glide ? { drop: glide, dropTime: 0.07 } : {}) });
  });

  // Claps, hats, rolls.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 4; k < beats; k++) {
    const t = p.at(k);
    const inBar = k % 4;
    const b = Math.floor(k / 4);
    const quiet = drop(t);
    if (inBar === 2 && !quiet) {
      ev.push({ v: 'sample', bus: 'drums', id: 'e-clap', t, gain: 0.5, pan: -0.04 });
      ev.push({ v: 'sample', bus: 'drums', id: 'e-snare', t, gain: 0.26, pan: 0.05 });
    }
    if (inBar === 3 && b % 2 === 1 && !quiet) ev.push({ v: 'sample', bus: 'drums', id: 'e-rim', t: p.at(k + 0.75), gain: 0.16, pan: -0.3 });
    const roll = inBar === 3 && b % 2 === 0 ? rolls[(b / 2) % 3]! : 0;
    if (roll) {
      for (let s = 0; s < roll; s++) {
        ev.push({ v: 'sample', bus: 'drums', id: 'e-hat', t: p.at(k + s / roll), choke: 'hat', gain: (0.12 + (0.14 * s) / roll) * (quiet ? 0.6 : 1), pan: 0.25 - (0.4 * s) / roll });
      }
    } else {
      ev.push({ v: 'sample', bus: 'drums', id: 'e-hat', t, choke: 'hat', gain: (quiet ? 0.13 : 0.24) + rnd() * 0.02, pan: 0.25 });
      if (inBar === 1 && b % 4 === 3 && !quiet) ev.push({ v: 'sample', bus: 'drums', id: 'e-hat-open', t: p.at(k + 0.5), choke: 'hat', gain: 0.16, pan: 0.3 });
      else ev.push({ v: 'sample', bus: 'drums', id: 'e-hat', t: p.at(k + 0.5), choke: 'hat', gain: (quiet ? 0.08 : 0.15) + rnd() * 0.02, pan: 0.2 });
    }
  }

  // Bell melody and pad.
  for (let b = 0; b < p.bars; b++) {
    const tb = p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const c = CHORDS[chordAt(tb)];
    const len = Math.min(bar, end - tb);
    const dark = drop(tb) || drop(tb + bar / 2);
    c.pad.forEach((m, j) => {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: tb, midi: m, dur: len, vel: 0.5, cutoff: dark ? 1400 : 800, reso: 0.8, detune: 18, width: 0.8, amp: { a: 0.25, d: 1, s: 0.75, r: 0.4 }, gain: 0.1, pan: (j - 1.5) * 0.25 });
    });
    for (let e = 0; e < 8; e++) {
      const i = melody[e]!;
      if (i < 0) continue;
      const t = p.at(b * 4 + e / 2);
      if (t >= end - 1e-9) break;
      ev.push({ v: 'bell', bus: 'lead', t, midi: c.tones[i]!, dur: beat * 0.9, vel: e === 0 ? 0.6 : 0.45, gain: dark ? 0.22 : 0.3, pan: e % 2 ? 0.25 : -0.25 });
    }
  }

  // Landings.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const c = CHORDS[chordAt(Math.max(t, t0))];
    ev.push({ v: 'bell', kind: 'glass', bus: 'lead', t, midi: c.tones[i % 4]! + 12, dur: 0.5, vel: 0.5 + 0.4 * w, gain: 0.4, pan: i % 2 ? 0.3 : -0.3, tag: 'land' });
    if (emph) {
      const swell = Math.min(beat, t);
      if (swell > 0.1) ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t: t - swell, len: swell, reverse: true, gain: 0.22, pan: -0.2 });
      ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t, gain: 0.22, pan: 0.2 });
      ev.push({ v: 'sub', bus: 'fx', t, midi: 28, drop: 12, dropTime: 0.06, dur: 0.5, decay: 0.7, release: 0.2, drive: 2, gain: 0.4 });
    }
  });

  // Camera moves: 32nd hat roll + high-pass sweep.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.15, mv.until - mv.t);
    const step = beat / 8;
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 0; k < n; k++) ev.push({ v: 'sample', bus: 'fx', id: 'e-hat', t: mv.t + k * step, gain: 0.06 + (0.14 * k) / n, pan: k % 2 ? 0.3 : -0.3 });
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len, filter: 'hp', f0: 400, f1: 7000, a: len * 0.9, curve: 2, r: 0.03, gain: 0.2, pan: i % 2 ? -0.4 : 0.4, panTo: i % 2 ? 0.4 : -0.4, salt: 60 + i });
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, filter: 'bp', f0: 300, f1: 6000, q: 1.2, a: (b - a) * 0.95, curve: 2.2, r: 0.04, gain: 0.28, salt: 98 });
  }

  // Ending: E 808, kick, crash, rolled Em(add9).
  const tail = p.dur - end;
  if (tail > 0.05) {
    kick(ev, end, 'e-kick', 0.95, 0.8, 0.09);
    ev.push({ v: 'sub', bus: 'bass', t: end, midi: 40, dur: tail * 0.85, decay: 2.4, release: tail * 0.15, drive: 2.4, gain: 0.5 });
    ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t: end, gain: 0.3 });
    [64, 66, 67, 71, 76].forEach((m, j) => ev.push({ v: 'bell', bus: 'lead', t: end + j * 0.07, midi: m, dur: tail - j * 0.07, vel: 0.6, gain: 0.26, pan: (j - 2) / 3 }));
    CHORDS.Em.pad.forEach((m, j) => ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: end, midi: m, dur: tail, vel: 0.5, cutoff: 1200, detune: 18, amp: { a: 0.05, d: 1.5, s: 0.7, r: 0.4 }, gain: 0.1, pan: (j - 1.5) * 0.25 }));
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 1, hp: 28, comp: { threshold: 0.4, ratio: 3, attack: 0.004, release: 0.09 }, reverb: 0.05 },
      bass: { gain: 1, hp: 32, lp: 2400 },
      lead: { gain: 1, hp: 250, lp: 9000, reverb: 0.3, delay: 0.3, width: 1.2 },
      pads: { gain: 1, hp: 180, chorus: { rate: 0.2, depth: 0.003, delay: 0.014, mix: 0.3 }, duck: { depth: 0.4, attack: 0.005, release: beat * 0.6 }, reverb: 0.3, width: 1.3 },
      fx: { gain: 0.8, hp: 25, reverb: 0.25 },
    },
    reverb: { size: 0.75, damp: 0.45, width: 1, predelay: 0.02, lowCut: 300, highCut: 7000, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.5, feedback: 0.35, damp: 3500, pingPong: true, gain: 1, reverb: 0.25 },
    glue: { threshold: 0.45, ratio: 2, attack: 0.008, release: 0.12 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const trap808: Preset = { name: 'Trap 808', description: 'Half-time 808s, rolling hats, dark bells', bpm: [130, 150], defaultBpm: 140, arrange };
