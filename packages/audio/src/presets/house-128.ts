/**
 * house-128 (118–130 bpm): deep-house in F minor, Fm9 – Eb6/9 – Dbmaj9 – Cm7 (i–VII–VI–v → i).
 *
 * - Four-on-the-floor kick, clap (+ snare layer) on 2 and 4, 16th closed hats with an accent pattern, open hats on
 *   the off-beats (choked by the closed hats), a quiet shaker, rim syncopation; a ride takes over in body/date.
 * - Off-beat saw bass with a sine sub, and a warm supersaw pad, both side-chained to the kick.
 * - Chord stabs on every landing (FM piano + square layer, an octave up on emphasis with a crash).
 * - Camera moves: a clap roll and a high-pass noise sweep into the arrival.
 * - The teaser is a breakdown: kick and bass out, pad open, riser.
 * - Ending: Cm7 → Fm9 stab and pad with a low boom, faded by the end.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

const CHORDS = {
  Fm9: { bass: 41, voicing: [56, 60, 63, 67] },
  Eb69: { bass: 39, voicing: [55, 58, 60, 65] },
  Dbmaj9: { bass: 37, voicing: [53, 56, 60, 63] },
  Cm7: { bass: 36, voicing: [55, 58, 63, 67] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Fm9', 'Eb69', 'Dbmaj9', 'Cm7'];
/** 16th closed-hat accents within a beat. */
const HAT = [0.55, 0.3, 0, 0.35];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const lastBar = p.bars - 1;
  const chordAt = (t: number): Chord => {
    if (t >= end - 1e-9) return 'Fm9';
    const b = p.barAt(t);
    return b === lastBar && b > 0 ? 'Cm7' : PROG[Math.max(0, b) % 4]!;
  };
  const breakdown = (t: number) => p.inTeaser(t);

  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 0; k < beats; k++) {
    const t = p.at(k);
    const bd = breakdown(t);
    const role = p.roleAt(t);
    if (!bd) {
      kick(ev, t, 'e-kick', 0.95, 0.85, 0.09);
      kicks.push(t);
      if (k % 2 === 1) {
        ev.push({ v: 'sample', bus: 'drums', id: 'e-clap', t, gain: 0.42, pan: -0.05 });
        ev.push({ v: 'sample', bus: 'drums', id: 'e-snare', t, gain: 0.14, pan: 0.05 });
      }
      if (k % 4 === 1 || k % 4 === 3) ev.push({ v: 'sample', bus: 'drums', id: 'e-rim', t: p.at(k + 0.75), gain: 0.14, pan: -0.35 });
    }
    const ride = role === 'body' || role === 'datetime';
    for (let s = 0; s < 4; s++) {
      const th = p.at(k + s / 4);
      if (s === 2) {
        if (!bd && ride) ev.push({ v: 'sample', bus: 'drums', id: 'e-ride', t: th, gain: 0.18, pan: 0.25 });
        else if (!bd) ev.push({ v: 'sample', bus: 'drums', id: 'e-hat-open', t: th, choke: 'hat', gain: 0.2, pan: 0.25 });
      } else if (!ride || bd) ev.push({ v: 'sample', bus: 'drums', id: 'e-hat', t: th, choke: 'hat', gain: HAT[s]! * 0.32 + rnd() * 0.02, pan: 0.25 });
      ev.push({ v: 'sample', bus: 'drums', id: 'shaker', t: th, gain: (s % 2 ? 0.07 : 0.1) * (bd ? 1.3 : 1), pan: -0.3 });
    }
  }

  // Bass, pads.
  for (let b = 0; b < p.bars; b++) {
    const tb = p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const c = CHORDS[chordAt(tb)];
    const len = Math.min(bar, end - tb);
    const bd = breakdown(tb) || breakdown(tb + bar / 2);
    c.voicing.forEach((m, j) => {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: tb, midi: m, dur: len, vel: 0.6, cutoff: bd ? 2400 : 1100, reso: 0.9, detune: 16, width: 0.8, amp: { a: 0.08, d: 0.8, s: 0.7, r: 0.3 }, gain: 0.14, pan: (j - 1.5) * 0.25 });
    });
    if (bd) continue;
    for (let q = 0; q < 4; q++) {
      const t = p.at(b * 4 + q + 0.5);
      if (t >= end - 1e-9) break;
      ev.push({ v: 'synth', osc: 'saw', bus: 'bass', t, midi: c.bass, dur: beat * 0.38, vel: 0.85, cutoff: 220, reso: 1.2, envAmt: 2.8, fenv: { a: 0.001, d: 0.11, s: 0.1, r: 0.04 }, amp: { a: 0.003, d: 0.2, s: 0.8, r: 0.05 }, drive: 1.4, gain: 0.42 });
      // A sine an octave under the saw would sit at 33–44 Hz, on top of the kick's boom; double the saw instead.
      ev.push({ v: 'sub', bus: 'bass', t, midi: c.bass, dur: beat * 0.4, release: 0.05, gain: 0.3 });
    }
  }

  // Stabs on landings.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const v = CHORDS[chordAt(Math.max(t, t0))].voicing.map((m) => m + 12);
    const notes = emph ? [...v, v[0]! + 12] : v;
    notes.forEach((m, j) => {
      ev.push({ v: 'epiano', bus: 'keys', t, midi: m, dur: beat * 0.4, vel: 0.75 + 0.25 * w, gain: 0.15, pan: (j - 1.5) * 0.2, ...(j === 0 ? { tag: 'land' } : {}) });
      ev.push({ v: 'synth', osc: 'square', bus: 'keys', t, midi: m, dur: beat * 0.25, vel: 0.7, cutoff: 1800, envAmt: 1.5, fenv: { a: 0.001, d: 0.1, s: 0, r: 0.05 }, amp: { a: 0.001, d: 0.15, s: 0.4, r: 0.08 }, gain: 0.05, pan: (j - 1.5) * 0.2 });
    });
    if (emph) ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t, gain: 0.25, pan: i % 2 ? 0.2 : -0.2 });
  });

  // Camera moves: clap roll + noise sweep.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.15, mv.until - mv.t);
    const step = beat / 4;
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 0; k < n; k++) ev.push({ v: 'sample', bus: 'fx', id: 'e-clap', t: mv.t + k * step, gain: 0.08 + (0.2 * k) / n, pan: (k % 2 ? 0.2 : -0.2) });
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len, filter: 'hp', f0: 300, f1: 8000, a: len * 0.9, curve: 2, r: 0.04, gain: 0.22, salt: 400 + i });
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, filter: 'bp', f0: 250, f1: 5000, q: 1.3, a: (b - a) * 0.95, curve: 2.2, r: 0.04, gain: 0.28, salt: 499 });
  }

  // Ending: Fm9.
  const tail = p.dur - end;
  if (tail > 0.05) {
    const v = CHORDS.Fm9.voicing;
    v.forEach((m, j) => {
      ev.push({ v: 'epiano', bus: 'keys', t: end + j * 0.01, midi: m + 12, dur: tail, vel: 0.8, gain: 0.1, pan: (j - 1.5) * 0.25 });
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: end, midi: m, dur: tail, vel: 0.6, cutoff: 1800, detune: 16, amp: { a: 0.05, d: 1.2, s: 0.7, r: 0.4 }, gain: 0.16, pan: (j - 1.5) * 0.25 });
    });
    kick(ev, end, 'e-kick', 1, 0.85, 0.09);
    ev.push({ v: 'sub', bus: 'bass', t: end, midi: 29, drop: 12, dropTime: 0.08, dur: tail * 0.8, decay: 2, release: tail * 0.2, gain: 0.5 });
    ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t: end, gain: 0.3 });
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 1, hp: 28, comp: { threshold: 0.45, ratio: 3, attack: 0.004, release: 0.09 }, reverb: 0.06 },
      bass: { gain: 1, hp: 30, lp: 1800, duck: { depth: 0.7, attack: 0.003, release: beat * 0.45 } },
      keys: { gain: 1, hp: 180, reverb: 0.25, delay: 0.25, width: 1.1 },
      pads: { gain: 1, hp: 200, chorus: { rate: 0.2, depth: 0.003, delay: 0.014, mix: 0.3 }, duck: { depth: 0.65, attack: 0.005, release: beat * 0.7 }, reverb: 0.3, width: 1.2 },
      fx: { gain: 1, hp: 30, reverb: 0.25 },
    },
    reverb: { size: 0.6, damp: 0.5, width: 1, predelay: 0.02, lowCut: 300, highCut: 7500, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.5, feedback: 0.3, damp: 3500, pingPong: true, gain: 1, reverb: 0.2 },
    glue: { threshold: 0.45, ratio: 2, attack: 0.01, release: 0.12 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const house128: Preset = { bpm: [118, 130], arrange };
