/**
 * acoustic-folk (84–108 bpm): a warm strummed G major, G – Em – C – D (I–vi–IV–V), resolving to G.
 *
 * - Guitar: Karplus–Strong strings strummed across six-string open voicings (down-strokes low→high, up-strokes
 *   high→low on the top four strings, ~9 ms between strings), in a seeded folk pattern of 8ths (D · D U · U D U).
 *   A thumb bass note (root, then the fifth) on beats 1 and 3, an octave above the kick's boom.
 * - Percussion: a dampened kick on 1 and 3, a cross-stick on 2 and 4, a shaker on the 16ths (accented off-beats),
 *   hand claps join in the body/date sections. The first bar is the guitar alone.
 * - Landings: a glockenspiel-like mallet on a chord tone, emphasis adds a harmonic chime an octave up and a
 *   tambourine-ish open hat. Camera moves: a soft brush swell. Teaser: the strum thins to whole-bar chords.
 * - Ending: a slow rolled G chord over a low G with a mallet arpeggio, faded by the end.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

/** Six-string voicings, low to high, and the thumb-bass root/fifth. */
const CHORDS = {
  G: { strings: [43, 47, 50, 55, 59, 67], root: 43, fifth: 50, bell: [67, 71, 74, 79] },
  Em: { strings: [40, 47, 52, 55, 59, 64], root: 40, fifth: 47, bell: [64, 67, 71, 76] },
  C: { strings: [48, 52, 55, 60, 64, 67], root: 48, fifth: 43, bell: [64, 67, 72, 76] },
  D: { strings: [45, 50, 57, 62, 66, 69], root: 50, fifth: 45, bell: [66, 69, 74, 78] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['G', 'Em', 'C', 'D'];
/** Strum patterns per 8th of a bar: 'D' down, 'U' up, '' rest. */
const PATTERNS: readonly (readonly ('D' | 'U' | '')[])[] = [
  ['D', '', 'D', 'U', '', 'U', 'D', 'U'],
  ['D', '', 'D', '', 'D', 'U', 'D', 'U'],
  ['D', 'U', '', 'U', 'D', 'U', '', 'U'],
];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const human = (x: number) => (rnd() * 2 - 1) * x;
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => {
    if (t >= end - 1e-9) return 'G';
    const b = p.barAt(t);
    return b === p.bars - 1 && b > 0 ? 'D' : PROG[Math.max(0, b) % 4]!;
  };
  const pattern = PATTERNS[Math.floor(rnd() * PATTERNS.length)]!;

  const strum = (t: number, c: Chord, dir: 'D' | 'U', vel: number, len: number) => {
    const s = CHORDS[c].strings;
    const notes = dir === 'D' ? s : s.slice(2).reverse();
    notes.forEach((m, j) => {
      ev.push({ v: 'pluck', bus: 'keys', t: t + j * 0.009, midi: m, dur: len, vel: Math.min(1, vel + human(0.05)), bright: dir === 'D' ? 0.55 : 0.7, decay: 2.2, gain: dir === 'D' ? 0.2 : 0.14, pan: -0.25 + (j / 5) * 0.5 });
    });
  };

  // Guitar and thumb bass.
  for (let b = 0; b < p.bars; b++) {
    const tb = p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const c = chordAt(tb);
    const thin = p.inTeaser(tb) || p.inTeaser(tb + bar / 2);
    if (thin) {
      strum(tb, c, 'D', 0.55, Math.min(bar, end - tb));
      continue;
    }
    for (let e = 0; e < 8; e++) {
      const dir = pattern[e]!;
      if (!dir) continue;
      const t = p.at(b * 4 + e / 2);
      if (t >= end - 1e-9) break;
      // Each stroke rings until the next one (choked by the hand), at most a beat.
      strum(t, c, dir, e % 2 ? 0.55 : 0.75, beat * 0.95);
    }
    for (const [pos, m] of [
      [0, CHORDS[c].root],
      [2, CHORDS[c].fifth],
    ] as const) {
      const t = p.at(b * 4 + pos);
      if (t >= end - 1e-9) break;
      ev.push({ v: 'pluck', bus: 'bass', t, midi: m, dur: beat * 1.6, vel: 0.85, bright: 0.3, decay: 2.5, gain: 0.5 });
    }
  }

  // Percussion from the second bar.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 4; k < beats; k++) {
    const t = p.at(k);
    const inBar = k % 4;
    const quiet = p.inTeaser(t);
    const role = p.roleAt(t);
    if (!quiet && (inBar === 0 || inBar === 2)) {
      kick(ev, t, 'lofi-kick', 0.75 + human(0.04), 0.35, 0.3);
      kicks.push(t);
    }
    if (inBar === 1 || inBar === 3) {
      ev.push({ v: 'sample', bus: 'drums', id: 'lofi-rim', t, gain: quiet ? 0.2 : 0.32, pan: -0.15 });
      if (!quiet && (role === 'body' || role === 'datetime')) ev.push({ v: 'sample', bus: 'drums', id: 'pop-clap', t, gain: 0.22, pan: 0.1 });
    }
    for (let s = 0; s < 4; s++) ev.push({ v: 'sample', bus: 'drums', id: 'shaker', t: p.at(k + s / 4), gain: (s === 2 ? 0.16 : 0.08) + human(0.02), pan: 0.35 });
  }

  // Landings: mallets; emphasis: chime + tambourine.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const m = CHORDS[chordAt(Math.max(t, t0))].bell[i % 4]!;
    ev.push({ v: 'bell', kind: 'mallet', bus: 'lead', t, midi: m + 12, dur: 0.8, vel: 0.5 + 0.4 * w, gain: 0.45, pan: i % 2 ? 0.3 : -0.3, tag: 'land' });
    if (emph) {
      ev.push({ v: 'bell', kind: 'glass', bus: 'lead', t: t + 0.02, midi: m + 24, dur: 1.2, vel: 0.6, gain: 0.18, pan: i % 2 ? -0.3 : 0.3 });
      ev.push({ v: 'sample', bus: 'drums', id: 'lofi-hat-open', t, len: 0.5, gain: 0.18, pan: 0.3 });
    }
  });

  // Camera moves: brush swell.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.2, mv.until - mv.t);
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len + 0.1, color: 'pink', filter: 'bp', f0: 1500, f1: 4500, q: 0.8, a: len * 0.85, curve: 2, r: 0.12, gain: 0.18, pan: i % 2 ? 0.4 : -0.4, panTo: i % 2 ? -0.4 : 0.4, salt: 30 + i });
  });

  // Ending: rolled G, low G, mallet arpeggio.
  const tail = p.dur - end;
  if (tail > 0.05) {
    CHORDS.G.strings.forEach((m, j) => ev.push({ v: 'pluck', bus: 'keys', t: end + j * 0.045, midi: m, dur: tail - j * 0.045, vel: 0.75, bright: 0.5, decay: 4, gain: 0.22, pan: -0.3 + j * 0.12 }));
    ev.push({ v: 'pluck', bus: 'bass', t: end, midi: 43, dur: tail, vel: 0.9, bright: 0.3, decay: 4, gain: 0.55 });
    kick(ev, end, 'lofi-kick', 0.8, 0.35, 0.3);
    [71, 74, 79, 83].forEach((m, j) => ev.push({ v: 'bell', kind: 'mallet', bus: 'lead', t: end + 0.3 + j * 0.2, midi: m, dur: 1.6, vel: 0.55, gain: 0.3, pan: 0.4 - j * 0.25 }));
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 1, hp: 30, lp: 10000, comp: { threshold: 0.4, ratio: 2.5, attack: 0.008, release: 0.12 }, reverb: 0.1 },
      bass: { gain: 1, hp: 40, lp: 1800, comp: { threshold: 0.35, ratio: 2.5, attack: 0.005, release: 0.15 } },
      keys: { gain: 1, hp: 90, lp: 9000, eq: [{ type: 'peak' as const, f: 250, q: 1, db: -3 }, { type: 'highshelf' as const, f: 4000, db: 2 }], comp: { threshold: 0.4, ratio: 2, attack: 0.01, release: 0.15 }, reverb: 0.2, width: 1.3 },
      lead: { gain: 1, hp: 300, reverb: 0.3, delay: 0.15 },
      fx: { gain: 1, hp: 300, reverb: 0.2 },
    },
    reverb: { size: 0.5, damp: 0.6, width: 1, predelay: 0.015, lowCut: 250, highCut: 7000, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.5, feedback: 0.25, damp: 3500, pingPong: true, gain: 1, reverb: 0.2 },
    glue: { threshold: 0.42, ratio: 2, attack: 0.015, release: 0.18 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const acousticFolk: Preset = { name: 'Acoustic Folk', description: 'Strummed guitar, shaker, warm and bright', bpm: [84, 108], defaultBpm: 96, arrange };
