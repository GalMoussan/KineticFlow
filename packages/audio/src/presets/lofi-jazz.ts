/**
 * lofi-jazz (80–110 bpm): a mellow swung groove in D major, I–vi–ii–V (Dmaj9 · Bm9 · Em9 · A13).
 *
 * - Drums: dampened kick, tape snare, brush taps, tight hats swung at 58 % (ride in the body/date sections, shaker
 *   under the location), all through a dark, saturated drum bus. The first bar is hats and brushes only; the kick
 *   drops out under the teaser and the snare turns into a cross-stick.
 * - FM electric piano comping (long chord on 1, a push on the swung "and" of 2, a soft re-touch on 4) with chorus.
 * - Upright-ish walking bass: Karplus–Strong string + a sine sub, root → chord tone → fifth → chromatic approach.
 * - A vibraphone-like mallet pluck on every word landing; emphasised words get a second note a fifth up and a low
 *   e-piano tine. Opening/closing decorations land like emphasised words.
 * - A brush swish across each camera move, vinyl crackle and tape hiss, a reversed-ride pickup into the first
 *   downbeat, and a resolving Dmaj9 (V → I) that fades by the end of the video.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

const SWING = 0.58;
type Quality = 'maj' | 'min' | 'dom';
const CHORDS = {
  Dmaj9: { root: 38, q: 'maj', voicing: [54, 57, 61, 64] },
  Bm9: { root: 35, q: 'min', voicing: [57, 61, 62, 66] },
  Em9: { root: 40, q: 'min', voicing: [55, 59, 62, 66] },
  A13: { root: 33, q: 'dom', voicing: [55, 61, 66, 71] },
} as const satisfies Record<string, { root: number; q: Quality; voicing: readonly number[] }>;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Dmaj9', 'Bm9', 'Em9', 'A13'];
const THIRD: Record<Quality, number> = { maj: 4, min: 3, dom: 4 };

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const human = (amount: number) => (rnd() * 2 - 1) * amount;
  const ev: MusicEvent[] = [];
  /** The bar sounding just before `end` plays the V chord. */
  const lastBar = p.bars - 1;
  const chordAt = (t: number): Chord => {
    if (t >= end - 1e-9) return 'Dmaj9';
    const b = p.barAt(t);
    if (b === lastBar && b > 0) return 'A13';
    return PROG[Math.max(b, 0) % 4]!;
  };

  const epiano = (t: number, dur: number, midis: readonly number[], vel: number, gain: number) => {
    midis.forEach((m, j) => {
      ev.push({ v: 'epiano', bus: 'keys', t: t + j * 0.012, dur, midi: m, vel: Math.min(1, vel + human(0.06)), gain, pan: (j - (midis.length - 1) / 2) * 0.3 });
    });
  };

  // Pickup: a reversed ride swelling into the first downbeat.
  if (t0 > 0.15) ev.push({ v: 'sample', bus: 'drums', id: 'lofi-ride', t: 0, len: t0, reverse: true, gain: 0.25, pan: 0.2 });

  // Keys and walking bass, bar by bar.
  for (let b = 0; t0 + b * bar < end - 1e-9; b++) {
    const tb = p.at(b * 4);
    const c = CHORDS[chordAt(tb)];
    const next = CHORDS[chordAt(p.at((b + 1) * 4))];
    const dark = p.inTeaser(tb) || p.inTeaser(tb + bar / 2);
    for (const [pos, len, vel, g] of [
      [0, 1.6, 0.55, 0.25],
      [1 + SWING, 0.7, 0.42, 0.19],
      [3, 0.8, 0.32, 0.15],
    ] as const) {
      const t = p.at(b * 4 + pos);
      if (t >= end - 1e-9) break;
      epiano(t, Math.min(len * beat, end - t + 0.05), c.voicing, dark ? vel * 0.7 : vel, g);
    }
    const third = c.root + THIRD[c.q];
    const approach = next.root + (rnd() < 0.5 ? -1 : 1);
    const line: [number, number, number][] = [
      [0, c.root, 0.95],
      [1, rnd() < 0.5 ? third : c.root + 12, 0.9],
      [2, c.root + 7, 0.9],
      [3, approach, 0.75],
    ];
    if (b % 2 === 1) line.push([3 + SWING, c.root + 7, 0.35]);
    for (const [pos, m, len] of line) {
      const t = p.at(b * 4 + pos);
      if (t >= end - 1e-9) break;
      const vel = pos === 0 ? 0.9 : 0.7 + human(0.08);
      ev.push({ v: 'pluck', bus: 'bass', t, midi: m, dur: len * beat, vel, bright: 0.22, decay: 1.6, gain: 0.55 });
      ev.push({ v: 'sub', bus: 'bass', t, midi: m, dur: len * beat * 0.85, release: 0.08, gain: 0.16 });
    }
  }

  // Drums on the beat grid.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 0; k < beats; k++) {
    const t = p.at(k);
    const inBar = k % 4;
    const quiet = p.inTeaser(t);
    const first = k < 4;
    const role = p.roleAt(t);
    if (!quiet && !first && (inBar === 0 || inBar === 2)) kick(ev, t, 'lofi-kick', 0.85 + human(0.05), 0.25, 0.3);
    if (!quiet && !first && inBar === 1 && Math.floor(k / 4) % 2 === 1) {
      kick(ev, p.at(k + SWING), 'lofi-kick', 0.5, 0.12, 0.3);
    }
    if (inBar === 1 || inBar === 3) {
      if (first) ev.push({ v: 'sample', bus: 'drums', id: 'lofi-brush', t, gain: 0.5, pan: -0.1 });
      else if (quiet) ev.push({ v: 'sample', bus: 'drums', id: 'lofi-rim', t, gain: 0.32, pan: -0.1 });
      else ev.push({ v: 'sample', bus: 'drums', id: 'lofi-snare', t, gain: 0.5 + human(0.04), pan: -0.08 });
    }
    // Brush ghost on the swung "and" of 4.
    if (inBar === 3 && !first) ev.push({ v: 'sample', bus: 'drums', id: 'lofi-brush', t: p.at(k + SWING), gain: 0.22, pan: -0.15 });
    const ride = role === 'body' || role === 'datetime';
    for (const [off, g] of [
      [0, 0.24],
      [SWING, 0.16],
    ] as const) {
      const th = p.at(k + off);
      if (ride) ev.push({ v: 'sample', bus: 'drums', id: 'lofi-ride', t: th, len: beat * 1.8, gain: g * 0.7 + human(0.02), pan: 0.3 });
      else ev.push({ v: 'sample', bus: 'drums', id: 'lofi-hat', t: th, choke: 'hat', gain: (quiet ? 0.6 : 1) * (g + human(0.03)), pan: 0.32 });
    }
    if (role === 'location') {
      for (const off of [0.25, 0.75]) ev.push({ v: 'sample', bus: 'drums', id: 'shaker', t: p.at(k + off), gain: 0.12 + human(0.03), pan: -0.4 });
    }
    if (role === 'cta' && inBar === 3) {
      ev.push({ v: 'sample', bus: 'drums', id: 'lofi-hat-open', t: p.at(k + SWING), choke: 'hat', gain: 0.2, pan: 0.32 });
    }
  }

  // A mallet pluck on every landing; emphasis adds a fifth above and a low tine.
  const plucks = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, weight: l.weight })), ...p.accents.map((t) => ({ t, emph: true, weight: 1 }))].sort(
    (a, b) => a.t - b.t,
  );
  plucks.forEach(({ t, emph, weight }, i) => {
    const v = CHORDS[chordAt(Math.max(t, t0))].voicing;
    const m = v[i % v.length]! + 12;
    const pan = i % 2 ? -0.35 : 0.35;
    ev.push({ v: 'bell', kind: 'mallet', bus: 'lead', t, midi: m, dur: 0.9, vel: 0.55 + 0.4 * weight, gain: 0.6, pan, tag: 'land' });
    if (emph) {
      ev.push({ v: 'bell', kind: 'mallet', bus: 'lead', t: t + 0.03, midi: m + 7 <= 88 ? m + 7 : m - 5, dur: 1, vel: 0.7, gain: 0.35, pan: -pan });
      ev.push({ v: 'epiano', bus: 'keys', t, midi: m - 12, dur: 0.4, vel: 0.8, gain: 0.15 });
    }
  });

  // Brush swish across each camera move.
  p.moves.forEach((m, i) => {
    const len = Math.max(0.2, m.until - m.t);
    ev.push({ v: 'noise', bus: 'fx', t: m.t, dur: len + 0.12, color: 'pink', filter: 'bp', f0: 1200, f1: 5200, q: 0.9, a: len * 0.8, curve: 2, r: 0.14, gain: 0.22, pan: i % 2 ? 0.5 : -0.5, panTo: i % 2 ? -0.5 : 0.5, salt: i });
  });

  // Vinyl: crackle and tape hiss.
  const crackle = mulberry32((music.seed + 0x9e3779b9) >>> 0);
  let k = 0;
  for (let t = 0.05; t < p.dur - 0.3; t += 0.05 + crackle() * 0.24) {
    ev.push({ v: 'noise', bus: 'fx', t, dur: 0.004, filter: 'hp', f0: 2500, a: 0.0005, r: 0.003, gain: 0.08 + crackle() * 0.22, pan: -0.6 + crackle() * 1.2, salt: 1000 + k++ });
  }
  ev.push({ v: 'noise', bus: 'fx', t: 0, dur: p.dur, color: 'pink', filter: 'lp', f0: 5000, a: 0.4, r: 1.5, gain: 0.012, salt: 1 });

  // Ending: V → I, rolled Dmaj9 with a mallet arpeggio, last kick and a ride bell.
  const tail = p.dur - end;
  if (tail > 0.05) {
    epiano(end, tail, [50, 54, 57, 61, 64, 69], 0.5, 0.18);
    [73, 76, 78, 81].forEach((m, j) => ev.push({ v: 'bell', kind: 'mallet', bus: 'lead', t: end + 0.25 + j * 0.18, midi: m, dur: 1.8, vel: 0.6, gain: 0.3, pan: 0.4 - j * 0.25 }));
    ev.push({ v: 'pluck', bus: 'bass', t: end, midi: 38, dur: tail, vel: 0.9, bright: 0.22, decay: 3, gain: 0.55 });
    ev.push({ v: 'sub', bus: 'bass', t: end, midi: 38, dur: tail * 0.8, release: tail * 0.2, gain: 0.18 });
    kick(ev, end, 'lofi-kick', 0.8, 0.25, 0.3);
    ev.push({ v: 'sample', bus: 'drums', id: 'lofi-ride', t: end, gain: 0.3, pan: 0.3 });
  }

  return {
    duration: p.dur,
    events: ev,
    kicks: [],
    buses: {
      drums: { gain: 1, lp: 9000, drive: 1.6, comp: { threshold: 0.35, ratio: 3, attack: 0.01, release: 0.12 }, reverb: 0.08 },
      bass: { gain: 1, lp: 2200, hp: 30, comp: { threshold: 0.3, ratio: 3, attack: 0.005, release: 0.15 } },
      keys: { gain: 1, hp: 140, lp: 7000, chorus: { rate: 0.35, depth: 0.0025, delay: 0.012, mix: 0.35 }, reverb: 0.22, width: 1.2 },
      lead: { gain: 1, hp: 300, reverb: 0.35, delay: 0.18 },
      fx: { gain: 1, hp: 180, lp: 9000, reverb: 0.1 },
    },
    reverb: { size: 0.55, damp: 0.55, width: 1, predelay: 0.02, lowCut: 250, highCut: 6500, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.75, feedback: 0.3, damp: 3200, pingPong: true, gain: 1, reverb: 0.2 },
    glue: { threshold: 0.4, ratio: 2, attack: 0.02, release: 0.2 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const lofiJazz: Preset = { bpm: [80, 110], arrange };
