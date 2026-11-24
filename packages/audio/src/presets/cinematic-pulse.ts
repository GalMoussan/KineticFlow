/**
 * cinematic-pulse (88–116 bpm): trailer-style D minor, Dm – Bb – F – C (i–VI–III–VII), resolving to Dm.
 *
 * - A 16th-note string ostinato (two detuned saws through a low-pass with a short filter envelope) on a seeded
 *   root/fifth/octave cell, accenting each beat; it runs from the first downbeat to the end, under the teaser too.
 * - Taiko-style drums: a pitched-down conga with a deep boom on beats 1 and 3 (plus a seeded pickup on the "a" of
 *   4), a dampened low tom feel from the lo-fi kick, and a quiet rim tick on the off-beats once the body starts.
 *   The first bar is the ostinato alone.
 * - Low string/choir pad (supersaw, slow attack, wide, big hall reverb) on each bar's chord.
 * - Landings: a brassy saw stab (chord tones, filter envelope); emphasis adds a taiko + boom, a cymbal and a high
 *   bell. Camera moves: a reversed cymbal and a noise riser into the arrival. The teaser drops the drums and opens
 *   the pad under a long riser.
 * - Ending: a full Dm hit (boom, taiko, cymbal, singing bowl) with a sustained pad, faded by the end.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { plan, type Preset, type PresetMusic } from './plan.ts';

const CHORDS = {
  Dm: { root: 50, pad: [50, 53, 57, 62], stab: [62, 65, 69, 74] },
  Bb: { root: 46, pad: [50, 53, 58, 62], stab: [62, 65, 70, 74] },
  F: { root: 41, pad: [48, 53, 57, 60], stab: [60, 65, 69, 72] },
  C: { root: 48, pad: [48, 52, 55, 60], stab: [60, 64, 67, 72] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Dm', 'Bb', 'F', 'C'];
/** Ostinato cells: semitones over the bar's root per 16th (0 root, 7 fifth, 12 octave, 3/4 third). */
const CELLS: readonly (readonly number[])[] = [
  [0, 0, 12, 0, 7, 0, 12, 7],
  [0, 12, 7, 12, 0, 12, 7, 3],
  [0, 0, 7, 0, 0, 12, 7, 0],
];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'Dm' : PROG[Math.max(0, p.barAt(t)) % 4]!);
  const cell = CELLS[Math.floor(rnd() * CELLS.length)]!;
  const pickup = rnd() < 0.5;

  /** Taiko: a conga an octave down, a dampened kick for the skin's body and a sine boom (the sub band's owner). */
  const taiko = (t: number, gain: number) => {
    ev.push({ v: 'sample', bus: 'drums', id: 'conga', t, semi: -14, gain: gain * 0.9, tag: 'kick' });
    ev.push({ v: 'sample', bus: 'drums', id: 'lofi-kick', t, len: 0.25, gain: gain * 0.6, tag: 'kick' });
    ev.push({ v: 'sub', bus: 'drums', t, midi: 31, drop: 12, dropTime: 0.03, dur: 0.12, decay: 0.35, release: 0.06, drive: 1.3, gain: gain * 0.9, tag: 'kick' });
    kicks.push(t);
  };

  // Ostinato: 16ths, two detuned saws per note.
  for (let s = 0; ; s++) {
    const t = p.at(s / 4);
    if (t >= end - 1e-9) break;
    const c = CHORDS[chordAt(t)];
    const accent = s % 4 === 0;
    const m = c.root + cell[s % 8]!;
    const soft = p.inTeaser(t) ? 0.75 : 1;
    for (const [d, pan] of [
      [-0.06, -0.35],
      [0.06, 0.35],
    ] as const) {
      ev.push({ v: 'synth', osc: 'saw', bus: 'keys', t, midi: m + d, dur: beat * 0.18, vel: accent ? 0.9 : 0.6, cutoff: 700, reso: 0.9, envAmt: 2.2, fenv: { a: 0.002, d: 0.08, s: 0.15, r: 0.05 }, amp: { a: 0.004, d: 0.12, s: 0.5, r: 0.06 }, gain: (accent ? 0.2 : 0.15) * soft, pan });
    }
  }

  // Pads, bar by bar.
  for (let b = 0; b < p.bars; b++) {
    const tb = p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const c = CHORDS[chordAt(tb)];
    const len = Math.min(bar, end - tb);
    const open = p.inTeaser(tb) || p.inTeaser(tb + bar / 2);
    c.pad.forEach((m, j) => {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: tb, midi: m, dur: len, vel: 0.55, cutoff: open ? 2200 : 1300, reso: 0.7, detune: 14, width: 0.9, amp: { a: 0.5, d: 1.5, s: 0.8, r: 0.6 }, gain: 0.12, pan: (j - 1.5) * 0.3 });
    });
  }

  // Drums from the second bar.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 4; k < beats; k++) {
    const t = p.at(k);
    if (p.inTeaser(t)) continue;
    const inBar = k % 4;
    if (inBar === 0 || inBar === 2) taiko(t, inBar === 0 ? 1 : 0.8);
    if (inBar === 3 && pickup && Math.floor(k / 4) % 2 === 1) taiko(p.at(k + 0.75), 0.55);
    if (inBar === 1 || inBar === 3) ev.push({ v: 'sample', bus: 'drums', id: 'conga', t, semi: -5, gain: 0.35, pan: inBar === 1 ? -0.3 : 0.3 });
    if (p.roleAt(t) !== 'title') ev.push({ v: 'sample', bus: 'drums', id: 'lofi-rim', t: p.at(k + 0.5), gain: 0.12, pan: 0.4 });
  }

  // Landings: brass stabs; emphasis: the big hit.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const c = CHORDS[chordAt(Math.max(t, t0))];
    c.stab.forEach((m, j) => {
      ev.push({ v: 'synth', osc: 'saw', bus: 'lead', t, midi: m, dur: beat * 0.5, vel: 0.6 + 0.35 * w, cutoff: 600, reso: 0.8, envAmt: 2.6, fenv: { a: 0.02, d: 0.25, s: 0.2, r: 0.15 }, amp: { a: 0.012, d: 0.4, s: 0.5, r: 0.25 }, gain: 0.11, pan: (j - 1.5) * 0.3, ...(j === 0 ? { tag: 'land' } : {}) });
    });
    if (emph) {
      if (t >= t0) taiko(t, 0.9);
      ev.push({ v: 'sample', bus: 'fx', id: 'fx-cymbal', t, gain: 0.22, pan: i % 2 ? 0.25 : -0.25 });
      ev.push({ v: 'bell', bus: 'fx', t, midi: c.stab[3]! + 12, dur: 1.2, vel: 0.6, gain: 0.14, pan: 0.2 });
    }
  });

  // Camera moves: reversed cymbal + riser into the arrival.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.15, mv.until - mv.t);
    ev.push({ v: 'sample', bus: 'fx', id: 'fx-cymbal', t: mv.t, len, reverse: true, gain: 0.3, pan: i % 2 ? 0.3 : -0.3 });
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len, color: 'pink', filter: 'bp', f0: 300, f1: 4000, q: 1.1, a: len * 0.9, curve: 2, r: 0.04, gain: 0.25, salt: 70 + i });
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, color: 'pink', filter: 'bp', f0: 200, f1: 5000, q: 1.3, a: (b - a) * 0.95, curve: 2.4, r: 0.04, gain: 0.32, salt: 97 });
    ev.push({ v: 'sample', bus: 'fx', id: 'fx-cymbal', t: a, len: b - a, reverse: true, gain: 0.25 });
  }

  // Ending: the big Dm hit.
  const tail = p.dur - end;
  if (tail > 0.05) {
    taiko(end, 1);
    ev.push({ v: 'sub', bus: 'fx', t: end, midi: 26, drop: 12, dropTime: 0.1, dur: tail * 0.8, decay: 2.5, release: tail * 0.2, drive: 1.5, gain: 0.5 });
    ev.push({ v: 'sample', bus: 'fx', id: 'fx-cymbal', t: end, gain: 0.3 });
    ev.push({ v: 'sample', bus: 'fx', id: 'fx-bowl', t: end + 0.02, gain: 0.3 });
    [38, 50, 53, 57, 62, 65].forEach((m, j) => ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: end, midi: m < 40 ? m + 12 : m, dur: tail, vel: 0.65, cutoff: 1800, detune: 14, width: 1, amp: { a: 0.03, d: 2, s: 0.75, r: 0.5 }, gain: 0.11, pan: (j - 2.5) * 0.2 }));
    CHORDS.Dm.stab.forEach((m, j) => ev.push({ v: 'synth', osc: 'saw', bus: 'lead', t: end, midi: m, dur: tail * 0.6, vel: 0.85, cutoff: 700, envAmt: 2.4, fenv: { a: 0.03, d: 0.6, s: 0.3, r: 0.4 }, amp: { a: 0.01, d: 1.2, s: 0.5, r: 0.5 }, gain: 0.1, pan: (j - 1.5) * 0.3 }));
  }

  return {
    duration: p.dur,
    events: ev,
    // Emphasis hits add taikos out of order; the duck walks its triggers in time order.
    kicks: kicks.sort((a, b) => a - b),
    buses: {
      drums: { gain: 1, hp: 28, comp: { threshold: 0.4, ratio: 3, attack: 0.006, release: 0.12 }, reverb: 0.18 },
      keys: { gain: 1, hp: 90, lp: 5000, comp: { threshold: 0.35, ratio: 2.5, attack: 0.005, release: 0.1 }, duck: { depth: 0.3, attack: 0.004, release: beat * 0.5 }, reverb: 0.2, width: 1.2 },
      lead: { gain: 1, hp: 150, reverb: 0.35, width: 1.2 },
      pads: { gain: 1, hp: 110, chorus: { rate: 0.15, depth: 0.003, delay: 0.016, mix: 0.3 }, duck: { depth: 0.3, attack: 0.008, release: beat * 0.8 }, reverb: 0.45, width: 1.4 },
      fx: { gain: 0.9, hp: 25, reverb: 0.4 },
    },
    reverb: { size: 0.9, damp: 0.45, width: 1, predelay: 0.03, lowCut: 200, highCut: 6500, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.5, feedback: 0.3, damp: 3000, pingPong: true, gain: 1, reverb: 0.3 },
    glue: { threshold: 0.42, ratio: 2, attack: 0.012, release: 0.2 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const cinematicPulse: Preset = { name: 'Cinematic Pulse', description: 'String ostinato, taiko hits, risers', bpm: [88, 116], defaultBpm: 100, arrange };
