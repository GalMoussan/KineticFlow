/**
 * chiptune (136–164 bpm): an 8-bit console tune in C major, C – Am – F – G (I–vi–IV–V), resolving to C.
 *
 * - Pulse channels like a 2A03: a 12.5 %/25 % pulse lead playing a seeded 8th-note hook over the chord tones, a
 *   50 % square arpeggio cycling the triad in 16ths (the "fast arp chord"), and a triangle bass on roots and fifths
 *   (an octave jump on the off-beats).
 * - Noise drums: a short sine kick with a pitch drop on 1 and 3, a white-noise snare on 2 and 4, closed-hat ticks
 *   (high-passed noise) on the 8ths. No samples, no reverb on the drums; a small room on the melody only.
 * - The first bar is the arpeggio alone. Under the teaser the bass and kick stop and the arp climbs.
 * - Landings: a pulse "coin" blip (two notes a fourth apart); emphasis adds a noise crash and a pitch-drop boom.
 *   Camera moves: a rising pulse sweep (power-up). Ending: C major arpeggio run up to a held chord, faded.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { plan, type Preset, type PresetMusic } from './plan.ts';

const CHORDS = {
  C: { root: 48, triad: [60, 64, 67] },
  Am: { root: 45, triad: [57, 60, 64] },
  F: { root: 41, triad: [57, 60, 65] },
  G: { root: 43, triad: [55, 59, 62] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['C', 'Am', 'F', 'G'];
/** Hooks: chord-tone index per 8th (3 = the octave of the triad's first note, −1 = rest). */
const HOOKS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, -1, 2, 1, 2],
  [3, -1, 2, 0, 1, 2, -1, 1],
  [0, 2, 3, 2, 1, -1, 0, 1],
];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'C' : PROG[Math.max(0, p.barAt(t)) % 4]!);
  const hook = HOOKS[Math.floor(rnd() * HOOKS.length)]!;
  const duty = rnd() < 0.5 ? 0.125 : 0.25;
  const tone = (c: Chord, i: number) => (i === 3 ? CHORDS[c].triad[0] + 12 : CHORDS[c].triad[i]!);
  const pulse = (t: number, midi: number, dur: number, gain: number, pw: number, bus: 'lead' | 'keys', pan: number, tag?: string) =>
    ev.push({ v: 'synth', osc: 'square', pw, bus, t, midi, dur, vel: 1, cutoff: 9000, amp: { a: 0.001, d: dur * 2, s: 0.75, r: 0.01 }, gain, pan, ...(tag ? { tag } : {}) });

  // Arpeggio (16ths) all the way; it climbs an octave under the teaser.
  for (let s = 0; ; s++) {
    const t = p.at(s / 4);
    if (t >= end - 1e-9) break;
    const c = chordAt(t);
    const up = p.inTeaser(t) ? 12 + 12 * ((s >> 2) % 2) : 0;
    pulse(t, CHORDS[c].triad[s % 3]! + 12 + up, beat / 4 - 0.004, 0.06, 0.5, 'keys', 0.25);
  }

  // Bass, hook and drums from the second bar.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 4; k < beats; k++) {
    const t = p.at(k);
    const c = chordAt(t);
    const inBar = k % 4;
    const quiet = p.inTeaser(t);
    for (const half of [0, 0.5]) {
      const th = p.at(k + half);
      if (!quiet) {
        const m = CHORDS[c].root + (half ? 12 : inBar === 2 ? 7 : 0);
        ev.push({ v: 'synth', osc: 'tri', bus: 'bass', t: th, midi: m, dur: beat * 0.42, vel: 1, cutoff: 8000, amp: { a: 0.001, d: 1, s: 1, r: 0.01 }, gain: 0.5 });
      }
      const i = hook[(inBar * 2 + (half ? 1 : 0)) % 8]!;
      if (i >= 0) pulse(th, tone(c, i) + 12, beat * 0.42, 0.1, duty, 'lead', -0.1);
      // Hat tick.
      ev.push({ v: 'noise', bus: 'drums', t: th, dur: 0.03, filter: 'hp', f0: 7000, a: 0.0005, r: 0.025, gain: half ? 0.12 : 0.18, salt: k * 2 + (half ? 1 : 0) });
    }
    if (quiet) continue;
    if (inBar === 0 || inBar === 2) {
      // A 2A03-style pitch-drop kick, landing at 49 Hz so it owns the sub band.
      ev.push({ v: 'sub', bus: 'drums', t, midi: 31, drop: 29, dropTime: 0.025, dur: 0.07, decay: 0.18, release: 0.02, drive: 2, gain: 0.85, tag: 'kick' });
      kicks.push(t);
    } else {
      ev.push({ v: 'noise', bus: 'drums', t, dur: 0.12, filter: 'bp', f0: 3000, f1: 1500, q: 0.6, a: 0.0008, r: 0.1, gain: 0.55, salt: 500 + k });
      ev.push({ v: 'synth', osc: 'tri', bus: 'drums', t, midi: 57, glideFrom: 69, glide: 0.03, dur: 0.05, vel: 1, cutoff: 8000, amp: { a: 0.001, d: 0.05, s: 0, r: 0.02 }, gain: 0.25 });
    }
  }

  // Landings: coin blips; emphasis: noise crash + boom.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const m = tone(chordAt(Math.max(t, t0)), i % 4) + 24;
    pulse(t, m, 0.06, 0.07 + 0.05 * w, 0.25, 'lead', 0.2, 'land');
    pulse(t + 0.06, m + 5, 0.18, 0.06 + 0.04 * w, 0.25, 'lead', 0.2);
    if (emph) {
      ev.push({ v: 'noise', bus: 'fx', t, dur: 0.6, filter: 'hp', f0: 2000, a: 0.001, r: 0.58, gain: 0.25, salt: 700 + i });
      ev.push({ v: 'sub', bus: 'fx', t, midi: 31, drop: 24, dropTime: 0.08, dur: 0.3, decay: 0.5, release: 0.1, drive: 2, gain: 0.45 });
    }
  });

  // Camera moves: power-up sweep (pulse steps up a scale into the arrival).
  p.moves.forEach((mv) => {
    const len = Math.max(0.15, mv.until - mv.t);
    const n = Math.max(3, Math.min(12, Math.floor(len / 0.035)));
    for (let k = 0; k < n; k++) pulse(mv.t + (len * k) / n, 72 + Math.round((k * 24) / n), len / n, 0.05, 0.125, 'lead', -0.2 + (0.4 * k) / n);
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, filter: 'hp', f0: 800, f1: 9000, a: (b - a) * 0.95, curve: 2, r: 0.04, gain: 0.16, salt: 96 });
  }

  // Ending: run up C major, then the chord.
  const tail = p.dur - end;
  if (tail > 0.05) {
    const run = [60, 64, 67, 72, 76, 79];
    const step = Math.min(0.06, tail / 10);
    run.forEach((m, j) => pulse(end + j * step, m, step, 0.09, 0.25, 'lead', 0));
    const hold = end + run.length * step;
    [60, 64, 67, 72].forEach((m, j) => pulse(hold, m + 12, p.dur - hold, 0.07, j % 2 ? 0.25 : 0.5, 'keys', (j - 1.5) * 0.3));
    ev.push({ v: 'synth', osc: 'tri', bus: 'bass', t: end, midi: 36, dur: tail, vel: 1, cutoff: 8000, amp: { a: 0.001, d: 3, s: 0.6, r: 0.05 }, gain: 0.55 });
    ev.push({ v: 'sub', bus: 'drums', t: end, midi: 31, drop: 29, dropTime: 0.025, dur: 0.07, decay: 0.18, release: 0.02, drive: 2, gain: 0.85, tag: 'kick' });
    ev.push({ v: 'noise', bus: 'fx', t: end, dur: 1, filter: 'hp', f0: 2000, a: 0.001, r: 0.98, gain: 0.22, salt: 999 });
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 1, hp: 25, comp: { threshold: 0.5, ratio: 3, attack: 0.003, release: 0.08 } },
      bass: { gain: 1, hp: 30, lp: 4000 },
      keys: { gain: 1, hp: 200, lp: 10000, reverb: 0.08, delay: 0.1, width: 1.1 },
      lead: { gain: 1, hp: 200, lp: 11000, reverb: 0.12, delay: 0.15 },
      fx: { gain: 0.8, hp: 30, reverb: 0.1 },
    },
    reverb: { size: 0.35, damp: 0.5, width: 1, predelay: 0.01, lowCut: 400, highCut: 8000, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.75, feedback: 0.25, damp: 5000, pingPong: true, gain: 1 },
    glue: { threshold: 0.5, ratio: 2, attack: 0.006, release: 0.1 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const chiptune: Preset = { name: 'Chiptune', description: '8-bit pulse arps, noise drums', bpm: [136, 164], defaultBpm: 150, arrange };
