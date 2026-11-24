/**
 * funk-disco (108–126 bpm): a nu-disco groove in A minor, Am9 – D9 – Gmaj7 – Cmaj7 (ii–V–I–IV feel in G), back to Am9.
 *
 * - Drums: four-on-the-floor kick, clap + snare on 2 and 4, 16th hats with an open hat on every off-beat (disco),
 *   a light 16th swing (54 %), and a conga figure in the body/date sections. The first bar is guitar and hats.
 * - Slap-ish octave bass: a plucky saw with a fast filter envelope jumping root ↔ octave on a seeded syncopated
 *   16th pattern, with ghosted dead notes; it sits at A1–D2 + octaves (≥ 55 Hz fundamentals mostly over the boom).
 * - Chicken-scratch guitar: muted Karplus–Strong strums (short, bright) on the off-16ths, plus e-piano stabs on the
 *   "and" of 2 and 4.
 * - A string-like supersaw pad holds each bar, ducked by the kick.
 * - Landings: an octave e-piano + glass stab on chord tones; emphasis adds a crash and a disco "pew" (a square with a
 *   falling pitch). Camera moves: a 16th clap roll and a filter sweep. Teaser: a filtered breakdown (kick + bass
 *   out, pad open, riser). Ending: Am9 stab with a crash and a held pad, faded.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

const SWING = 0.54;
const CHORDS = {
  Am9: { root: 33, voicing: [55, 59, 60, 64], scratch: [57, 60, 64, 67] },
  D9: { root: 38, voicing: [54, 57, 60, 64], scratch: [57, 60, 62, 66] },
  Gmaj7: { root: 43, voicing: [54, 59, 62, 67], scratch: [55, 59, 62, 66] },
  Cmaj7: { root: 36, voicing: [55, 59, 64, 67], scratch: [55, 60, 64, 67] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Am9', 'D9', 'Gmaj7', 'Cmaj7'];
/** Bass per 16th of a bar: 0 root, 1 octave, 2 dead note (muted thump), −1 rest. */
const BASS: readonly (readonly number[])[] = [
  [0, -1, 1, 2, -1, 0, 1, -1, 0, -1, 1, 2, -1, 0, 1, 0],
  [0, 2, 1, -1, 0, -1, 1, 2, 0, 2, 1, -1, -1, 0, 1, -1],
];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const human = (x: number) => (rnd() * 2 - 1) * x;
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'Am9' : PROG[Math.max(0, p.barAt(t)) % 4]!);
  const bassLine = BASS[Math.floor(rnd() * BASS.length)]!;
  /** Time of 16th `s` counted from t0, with the odd 16ths swung. */
  const at16 = (s: number) => p.at(Math.floor(s / 2) / 2 + (s % 2 ? SWING / 2 : 0));
  const breakdown = (t: number) => p.inTeaser(t);

  // Drums.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 0; k < beats; k++) {
    const t = p.at(k);
    const bd = breakdown(t);
    const first = k < 4;
    const role = p.roleAt(t);
    if (!bd && !first) {
      kick(ev, t, 'e-kick', 0.9, 0.75, 0.09);
      kicks.push(t);
      if (k % 2 === 1) {
        ev.push({ v: 'sample', bus: 'drums', id: 'pop-clap', t, gain: 0.4, pan: -0.05 });
        ev.push({ v: 'sample', bus: 'drums', id: 'e-snare', t, gain: 0.2, pan: 0.05 });
      }
    }
    for (let s = 0; s < 4; s++) {
      const th = at16(k * 4 + s);
      if (s === 2 && !bd) ev.push({ v: 'sample', bus: 'drums', id: 'e-hat-open', t: th, choke: 'hat', gain: 0.18, pan: 0.25 });
      else ev.push({ v: 'sample', bus: 'drums', id: 'e-hat', t: th, choke: 'hat', gain: (s === 0 ? 0.2 : 0.12) * (bd ? 0.7 : 1) + human(0.015), pan: 0.25 });
    }
    if (!bd && (role === 'body' || role === 'datetime' || role === 'location')) {
      for (const [s, semi, g] of [
        [1, 0, 0.18],
        [3, 5, 0.22],
      ] as const) {
        ev.push({ v: 'sample', bus: 'drums', id: 'conga', t: at16(k * 4 + s), semi, gain: g, pan: -0.35 });
      }
    }
  }

  // Bass, guitar, stabs, pad.
  for (let b = 0; b < p.bars; b++) {
    const tb = p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const cn = chordAt(tb);
    const c = CHORDS[cn];
    const bd = breakdown(tb) || breakdown(tb + bar / 2);
    const len = Math.min(bar, end - tb);
    c.voicing.forEach((m, j) => {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: tb, midi: m + 12, dur: len, vel: 0.5, cutoff: bd ? 3000 : 1600, reso: 0.7, detune: 14, width: 0.9, amp: { a: 0.12, d: 1, s: 0.7, r: 0.3 }, gain: 0.08, pan: (j - 1.5) * 0.3 });
    });
    for (let s = 0; s < 16; s++) {
      const t = at16(b * 16 + s);
      if (t >= end - 1e-9) break;
      // Chicken scratch on the off-16ths (and a full scratch on every "and").
      if (s % 2 === 1 || s % 4 === 2) {
        const full = s % 4 === 2;
        c.scratch.forEach((m, j) => {
          ev.push({ v: 'pluck', bus: 'keys', t: t + j * 0.004, midi: m, dur: full ? 0.07 : 0.035, vel: full ? 0.8 : 0.55, bright: 0.85, decay: 0.4, gain: full ? 0.11 : 0.07, pan: 0.35 });
        });
      }
      if (bd || b === 0) continue;
      const n = bassLine[s]!;
      if (n < 0) continue;
      const m = n === 1 ? c.root + 12 : c.root;
      // Fundamentals under ~50 Hz (A1) go up an octave: the kick's boom owns the sub band.
      const midi = m < 36 ? m + 12 : m;
      if (n === 2) ev.push({ v: 'synth', osc: 'saw', bus: 'bass', t, midi, dur: 0.03, vel: 0.5, cutoff: 300, envAmt: 2, fenv: { a: 0.001, d: 0.02, s: 0, r: 0.01 }, amp: { a: 0.001, d: 0.03, s: 0, r: 0.01 }, gain: 0.3 });
      else ev.push({ v: 'synth', osc: 'saw', bus: 'bass', t, midi, dur: beat * 0.2, vel: s % 4 === 0 ? 0.95 : 0.75, cutoff: 260, reso: 1.3, envAmt: 3.6, fenv: { a: 0.001, d: 0.06, s: 0.05, r: 0.03 }, amp: { a: 0.001, d: 0.18, s: 0.5, r: 0.04 }, drive: 1.5, gain: 0.48 });
    }
    for (const pos of [1.5, 3.5]) {
      const t = p.at(b * 4 + pos);
      if (t >= end - 1e-9 || bd) continue;
      c.voicing.forEach((m, j) => ev.push({ v: 'epiano', bus: 'keys', t: t + j * 0.004, midi: m, dur: beat * 0.2, vel: 0.55, gain: 0.12, pan: (j - 1.5) * 0.25 }));
    }
  }

  // Landings.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const c = CHORDS[chordAt(Math.max(t, t0))];
    const m = c.voicing[i % 4]! + 12;
    ev.push({ v: 'epiano', bus: 'lead', t, midi: m, dur: beat * 0.5, vel: 0.7 + 0.3 * w, gain: 0.2, pan: i % 2 ? 0.25 : -0.25, tag: 'land' });
    ev.push({ v: 'bell', kind: 'glass', bus: 'lead', t, midi: m + 12, dur: 0.4, vel: 0.5 + 0.3 * w, gain: 0.15, pan: i % 2 ? -0.25 : 0.25 });
    if (emph) {
      ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t, gain: 0.24, pan: 0.2 });
      ev.push({ v: 'synth', osc: 'square', bus: 'fx', t, midi: 64, glideFrom: 88, glide: 0.25, dur: 0.25, vel: 0.8, cutoff: 3000, reso: 2, amp: { a: 0.001, d: 0.3, s: 0.2, r: 0.1 }, gain: 0.1, pan: -0.2 });
    }
  });

  // Camera moves: clap roll + filter sweep.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.15, mv.until - mv.t);
    const step = beat / 4;
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 0; k < n; k++) ev.push({ v: 'sample', bus: 'fx', id: 'pop-clap', t: mv.t + k * step, gain: 0.06 + (0.16 * k) / n, pan: k % 2 ? 0.2 : -0.2 });
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len, filter: 'bp', f0: 500, f1: 6000, q: 1.5, a: len * 0.9, curve: 2, r: 0.03, gain: 0.2, salt: 80 + i });
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, filter: 'bp', f0: 250, f1: 5000, q: 1.3, a: (b - a) * 0.95, curve: 2.2, r: 0.04, gain: 0.26, salt: 94 });
  }

  // Ending: Am9.
  const tail = p.dur - end;
  if (tail > 0.05) {
    kick(ev, end, 'e-kick', 0.95, 0.75, 0.09);
    ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t: end, gain: 0.3 });
    CHORDS.Am9.voicing.forEach((m, j) => {
      ev.push({ v: 'epiano', bus: 'keys', t: end + j * 0.012, midi: m, dur: tail, vel: 0.7, gain: 0.14, pan: (j - 1.5) * 0.25 });
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: end, midi: m + 12, dur: tail, vel: 0.55, cutoff: 2200, detune: 14, amp: { a: 0.05, d: 1.5, s: 0.7, r: 0.4 }, gain: 0.09, pan: (j - 1.5) * 0.3 });
    });
    ev.push({ v: 'synth', osc: 'saw', bus: 'bass', t: end, midi: 45, dur: tail * 0.7, vel: 0.9, cutoff: 300, envAmt: 2.5, fenv: { a: 0.001, d: 0.1, s: 0.1, r: 0.3 }, amp: { a: 0.001, d: 1.5, s: 0.3, r: 0.4 }, gain: 0.45 });
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 1, hp: 28, comp: { threshold: 0.45, ratio: 3, attack: 0.004, release: 0.09 }, reverb: 0.06 },
      bass: { gain: 1, hp: 35, lp: 2500, comp: { threshold: 0.35, ratio: 3, attack: 0.003, release: 0.08 }, duck: { depth: 0.45, attack: 0.003, release: beat * 0.35 } },
      keys: { gain: 1, hp: 220, lp: 8000, reverb: 0.15, width: 1.2 },
      lead: { gain: 1, hp: 250, reverb: 0.25, delay: 0.2 },
      pads: { gain: 1, hp: 200, chorus: { rate: 0.25, depth: 0.003, delay: 0.014, mix: 0.35 }, duck: { depth: 0.55, attack: 0.005, release: beat * 0.6 }, reverb: 0.3, width: 1.3 },
      fx: { gain: 0.9, hp: 30, reverb: 0.25 },
    },
    reverb: { size: 0.55, damp: 0.5, width: 1, predelay: 0.015, lowCut: 300, highCut: 7500, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.5, feedback: 0.3, damp: 3500, pingPong: true, gain: 1, reverb: 0.2 },
    glue: { threshold: 0.45, ratio: 2, attack: 0.008, release: 0.12 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const funkDisco: Preset = { name: 'Funk Disco', description: 'Octave bass, chicken-scratch guitar, claps', bpm: [108, 126], defaultBpm: 118, arrange };
