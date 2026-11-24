/**
 * ambient-drift (64–84 bpm): a slow, airy A major-ish drift, Amaj9 – F#m11 – Dmaj9(#11) – Esus4 (I–vi–IV–Vsus),
 * resolving to Amaj9.
 *
 * - Pads: long supersaw chords with slow attacks and a wide chorus, crossfading bar to bar, plus a soft triangle
 *   drone on the tonic an octave over the kick's boom.
 * - Bells: a sparse, seeded glass/bell figure on chord tones (a few 8ths per bar) through a long ping-pong delay
 *   and a big reverb.
 * - A sparse beat: a soft kick on beat 1 of every bar (and a ghost on the "and" of 3 every other bar), a rim click
 *   on beat 3 and a quiet shaker on the off-beats; from the second bar, never under the teaser.
 * - Landings: a glass bell on a chord tone (emphasis adds the fifth above and a singing bowl). Camera moves: a slow
 *   filtered-noise wind swell. Ending: Amaj9 bloom with a bowl, faded by the end.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32 } from '../rng.ts';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

const CHORDS = {
  Amaj9: { root: 45, pad: [57, 61, 64, 68, 71], bells: [73, 76, 80, 83] },
  'F#m11': { root: 42, pad: [54, 57, 61, 64, 71], bells: [69, 73, 76, 81] },
  Dmaj9: { root: 50, pad: [54, 57, 61, 64, 68], bells: [69, 73, 76, 80] },
  Esus4: { root: 52, pad: [52, 57, 59, 64, 66], bells: [71, 76, 78, 83] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Amaj9', 'F#m11', 'Dmaj9', 'Esus4'];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const rnd = mulberry32(music.seed);
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'Amaj9' : PROG[Math.max(0, p.barAt(t)) % 4]!);

  // Pads + drone, from 0 so the intro breathes in (the bars overlap through their releases).
  for (let b = -1; b < p.bars; b++) {
    const tb = b < 0 ? 0 : p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const len = b < 0 ? t0 : Math.min(bar, end - tb);
    if (len < 0.05) continue;
    const c = CHORDS[chordAt(Math.max(tb, t0))];
    c.pad.forEach((m, j) => {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: tb, midi: m, dur: len, vel: 0.5, cutoff: 1500, reso: 0.6, detune: 12, width: 1, amp: { a: Math.min(1.2, bar * 0.4), d: 2, s: 0.85, r: 1.2 }, gain: 0.09, pan: (j - 2) * 0.25 });
    });
    ev.push({ v: 'synth', osc: 'tri', bus: 'bass', t: tb, midi: c.root + 12, dur: len, vel: 0.6, cutoff: 900, amp: { a: 0.6, d: 2, s: 0.9, r: 1 }, gain: 0.32 });
  }

  // Bell figure: up to 4 seeded 8ths per bar.
  for (let b = 0; b < p.bars; b++) {
    const c = CHORDS[chordAt(p.at(b * 4))];
    for (let e = 0; e < 8; e++) {
      if (rnd() > (e % 2 ? 0.25 : 0.45)) continue;
      const t = p.at(b * 4 + e / 2);
      if (t >= end - 1e-9) break;
      ev.push({ v: 'bell', kind: rnd() < 0.5 ? 'glass' : 'bell', bus: 'lead', t, midi: c.bells[Math.floor(rnd() * 4)]!, dur: beat * 2, vel: 0.35 + rnd() * 0.2, gain: 0.22, pan: rnd() * 1.2 - 0.6 });
    }
  }

  // Sparse beat.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 4; k < beats; k++) {
    const t = p.at(k);
    if (p.inTeaser(t)) continue;
    const inBar = k % 4;
    if (inBar === 0) {
      kick(ev, t, 'lofi-kick', 0.7, 0.55, 0.25);
      kicks.push(t);
    }
    if (inBar === 2 && Math.floor(k / 4) % 2 === 1) {
      const tg = p.at(k + 0.5);
      kick(ev, tg, 'lofi-kick', 0.4, 0.3, 0.25);
      kicks.push(tg);
    }
    if (inBar === 2) ev.push({ v: 'sample', bus: 'drums', id: 'lofi-rim', t, gain: 0.22, pan: -0.2 });
    ev.push({ v: 'sample', bus: 'drums', id: 'shaker', t: p.at(k + 0.5), gain: 0.07, pan: 0.35 });
  }

  // Landings.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const m = CHORDS[chordAt(Math.max(t, t0))].bells[i % 4]!;
    ev.push({ v: 'bell', kind: 'glass', bus: 'lead', t, midi: m, dur: 1.2, vel: 0.5 + 0.4 * w, gain: 0.42, pan: i % 2 ? 0.3 : -0.3, tag: 'land' });
    if (emph) {
      ev.push({ v: 'bell', kind: 'bell', bus: 'lead', t: t + 0.03, midi: m + 7 <= 91 ? m + 7 : m - 5, dur: 1.6, vel: 0.5, gain: 0.2, pan: i % 2 ? -0.3 : 0.3 });
      ev.push({ v: 'sample', bus: 'fx', id: 'fx-bowl', t, gain: 0.2, pan: 0.1 });
    }
  });

  // Camera moves: wind swell.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.3, mv.until - mv.t);
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len + 0.3, color: 'pink', filter: 'bp', f0: 400, f1: 2400, q: 1.5, a: len * 0.8, curve: 1.6, r: 0.3, gain: 0.25, pan: i % 2 ? 0.5 : -0.5, panTo: i % 2 ? -0.5 : 0.5, salt: 20 + i });
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, color: 'pink', filter: 'bp', f0: 300, f1: 3000, q: 1.4, a: (b - a) * 0.9, curve: 1.8, r: 0.1, gain: 0.22, salt: 95 });
  }

  // Ending: Amaj9 bloom.
  const tail = p.dur - end;
  if (tail > 0.05) {
    [45, 57, 61, 64, 68, 71, 76].forEach((m, j) => ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: end, midi: m < 50 ? m + 12 : m, dur: tail, vel: 0.55, cutoff: 1900, detune: 12, width: 1, amp: { a: 0.15, d: 2, s: 0.85, r: 0.8 }, gain: 0.09, pan: (j - 3) * 0.2 }));
    [73, 76, 80, 83, 88].forEach((m, j) => ev.push({ v: 'bell', kind: 'glass', bus: 'lead', t: end + j * 0.16, midi: m, dur: tail - j * 0.16, vel: 0.5, gain: 0.25, pan: 0.5 - j * 0.25 }));
    ev.push({ v: 'sample', bus: 'fx', id: 'fx-bowl', t: end, gain: 0.3 });
    kick(ev, end, 'lofi-kick', 0.6, 0.55, 0.25);
    ev.push({ v: 'synth', osc: 'tri', bus: 'bass', t: end, midi: 57, dur: tail, vel: 0.6, cutoff: 900, amp: { a: 0.05, d: 3, s: 0.7, r: 0.6 }, gain: 0.32 });
  }

  return {
    duration: p.dur,
    events: ev,
    kicks: kicks.sort((a, b) => a - b),
    buses: {
      drums: { gain: 0.9, hp: 28, lp: 9000, comp: { threshold: 0.4, ratio: 2.5, attack: 0.01, release: 0.15 }, reverb: 0.2 },
      bass: { gain: 1, hp: 40, lp: 1500 },
      lead: { gain: 1, hp: 350, reverb: 0.5, delay: 0.4, width: 1.3 },
      pads: { gain: 1, hp: 140, chorus: { rate: 0.12, depth: 0.004, delay: 0.018, mix: 0.4 }, duck: { depth: 0.2, attack: 0.01, release: beat }, reverb: 0.45, width: 1.4 },
      fx: { gain: 0.8, hp: 120, reverb: 0.45 },
    },
    reverb: { size: 0.92, damp: 0.5, width: 1, predelay: 0.04, lowCut: 250, highCut: 6000, gain: 1 },
    delay: { left: beat * 0.75, right: beat, feedback: 0.45, damp: 2800, pingPong: true, gain: 1, reverb: 0.35 },
    glue: { threshold: 0.4, ratio: 1.8, attack: 0.02, release: 0.25 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const ambientDrift: Preset = { name: 'Ambient Drift', description: 'Slow pads, glass bells, a sparse beat', bpm: [64, 84], defaultBpm: 74, arrange };
