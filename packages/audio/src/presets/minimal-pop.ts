/**
 * minimal-pop (100–130 bpm), for swiss: tight, dry and punchy, after OpenKatana's `make_score12.py`. Dm–Bb–F–C.
 *
 * - Kick on every beat, clap (+ a quiet snare layer) on 2 and 4, off-beat hats with a 16th pickup at the end of
 *   each bar and an open hat on the "and" of 4 every other bar.
 * - Plucky 8th-note bass (root/fifth/octave pattern, square through a snappy filter + sine sub).
 * - Muted e-piano stabs on the "and" of 2 and 4.
 * - Each landing is a "reveal hit": a bell on the chord's top note two octaves up, a short thump and a click;
 *   emphasised landings get a big hit (sub boom, crash, bell triad).
 * - Camera moves are panel wipes: a noise whoosh with a rising zip that lands on the arrival, then a slam.
 * - The teaser is a drop: kick and bass out, a riser, and the teaser's landings climb a Dm pentatonic.
 * - Ending: stinger kick + boom + crash, Dm(add9) bell stinger over a soft triangle pad, faded by the end.
 */
import type { CueSheet } from '@reel/core';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

/** root, fifth, octave, third, top + a stab voicing. */
const CHORDS = {
  Dm: { tones: [38, 45, 50, 53, 57], stab: [57, 62, 65, 69] },
  Bb: { tones: [34, 41, 46, 50, 53], stab: [58, 62, 65, 70] },
  F: { tones: [41, 48, 53, 57, 60], stab: [57, 60, 65, 69] },
  C: { tones: [36, 43, 48, 52, 55], stab: [55, 60, 64, 67] },
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Dm', 'Bb', 'F', 'C'];
const CLIMB = [74, 77, 79, 81, 84, 86, 89];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, t0, end } = p;
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'Dm' : PROG[Math.max(0, p.barAt(t)) % 4]!);
  const drop = (t: number) => p.inTeaser(t);

  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 0; k < beats; k++) {
    const t = p.at(k);
    const inDrop = drop(t);
    if (!inDrop) {
      kick(ev, t, 'pop-kick', 0.9, 0.6, 0.09);
      kicks.push(t);
      if (k % 2 === 1) {
        ev.push({ v: 'sample', bus: 'drums', id: 'pop-clap', t, gain: 0.5, pan: -0.04 });
        ev.push({ v: 'sample', bus: 'drums', id: 'pop-snare', t, gain: 0.18, pan: 0.04 });
      }
    }
    ev.push({ v: 'sample', bus: 'drums', id: 'pop-hat', t: p.at(k + 0.5), choke: 'hat', gain: 0.28, pan: 0.3 });
    if (k % 4 === 3 || inDrop) ev.push({ v: 'sample', bus: 'drums', id: 'pop-hat', t: p.at(k + 0.75), choke: 'hat', gain: 0.16, pan: -0.3 });
    if (k % 8 === 7 && !inDrop) ev.push({ v: 'sample', bus: 'drums', id: 'pop-hat-open', t: p.at(k + 0.5), choke: 'hat', gain: 0.18, pan: 0.3 });
  }

  // Bass (8ths) and stabs.
  const pattern = [0, 0, 2, 0, 0, 1, 0, 2];
  for (let s = 0; ; s++) {
    const t = p.at(s / 2);
    if (t >= end - 1e-9) break;
    const c = CHORDS[chordAt(t)];
    if (!drop(t)) {
      // Notes under E2 go up an octave (bass ≥ 82 Hz): the kick's boom owns the sub band.
      const tone = [c.tones[0], c.tones[1], c.tones[2]][pattern[s % 8]!]!;
      const m = tone < 40 ? tone + 12 : tone;
      ev.push({ v: 'synth', osc: 'square', bus: 'bass', t, midi: m, dur: beat * 0.32, vel: s % 2 ? 0.65 : 0.85, cutoff: 380, reso: 1.3, envAmt: 3.4, fenv: { a: 0.001, d: 0.09, s: 0, r: 0.04 }, amp: { a: 0.002, d: 0.16, s: 0.35, r: 0.04 }, gain: 0.42 });
      ev.push({ v: 'sub', bus: 'bass', t, midi: m, dur: beat * 0.36, release: 0.05, gain: 0.2 });
    }
    if (s % 4 === 3) {
      const st = c.stab;
      st.forEach((m, j) => ev.push({ v: 'epiano', bus: 'keys', t: t + j * 0.004, midi: m, dur: beat * 0.18, vel: 0.5, gain: 0.18, pan: (j - 1.5) * 0.25 }));
    }
  }

  // Landings: reveal hits; emphasis: big hits; teaser landings climb.
  let climb = 0;
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight, teaser: l.role === 'teaser' })), ...p.accents.map((t) => ({ t, emph: true, w: 1, teaser: false }))].sort(
    (a, b) => a.t - b.t,
  );
  hits.forEach(({ t, emph, w, teaser }, i) => {
    const c = CHORDS[chordAt(Math.max(t, t0))];
    const top = teaser ? CLIMB[climb++ % CLIMB.length]! : c.tones[3] + 24;
    ev.push({ v: 'bell', kind: 'mallet', bus: 'lead', t, midi: top, dur: 0.3, vel: 0.5 + 0.5 * w, gain: 0.5 * (0.5 + 0.5 * w), pan: 0.2, tag: 'land' });
    ev.push({ v: 'sub', bus: 'drums', t, midi: 48, dur: 0.045, release: 0.03, gain: 0.25 * w });
    ev.push({ v: 'noise', bus: 'drums', t, dur: 0.012, filter: 'hp', f0: 3000, a: 0.0005, r: 0.01, gain: 0.25 * w, salt: i });
    if (emph) {
      ev.push({ v: 'sub', bus: 'fx', t, midi: 26, drop: 12, dropTime: 0.07, dur: 0.6, decay: 0.8, release: 0.2, drive: 1.6, gain: 0.5 });
      ev.push({ v: 'sample', bus: 'fx', id: 'pop-crash', t, gain: 0.28, pan: -0.1 });
      [c.tones[2] + 24, c.tones[3] + 24, c.tones[4] + 24].forEach((m, k) => ev.push({ v: 'bell', bus: 'lead', t, midi: m, dur: 0.45, vel: 0.6, gain: 0.16, pan: (k - 1) * 0.5 }));
    }
  });

  // Panel wipes: whoosh + rising zip into the arrival, then a slam.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.15, mv.until - mv.t);
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len, filter: 'bp', f0: 600, f1: 4000, q: 1, a: len * 0.85, curve: 2, r: 0.05, gain: 0.35, pan: i % 2 ? 0.4 : -0.4, panTo: i % 2 ? -0.4 : 0.4, salt: 200 + i });
    for (let k = 0; k < 6; k++) {
      const tz = mv.t + len * (0.15 + k * 0.13);
      ev.push({ v: 'bell', kind: 'glass', bus: 'lead', t: tz, midi: 64 + k * 4, dur: 0.06, vel: 0.4 + k * 0.08, gain: 0.08 });
    }
    ev.push({ v: 'sample', bus: 'drums', id: 'pop-rim', t: mv.until, gain: 0.35 });
    ev.push({ v: 'sub', bus: 'drums', t: mv.until, midi: 40, dur: 0.1, release: 0.03, gain: 0.3 });
  });
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, filter: 'hp', f0: 400, f1: 7000, a: (b - a) * 0.9, curve: 2, r: 0.05, gain: 0.22, salt: 300 });
  }

  // Ending.
  const tail = p.dur - end;
  if (tail > 0.05) {
    kick(ev, end, 'pop-kick', 1, 0.6, 0.09);
    ev.push({ v: 'sub', bus: 'bass', t: end, midi: 26, drop: 12, dropTime: 0.08, dur: tail * 0.8, decay: 2.2, release: tail * 0.2, drive: 1.5, gain: 0.5 });
    ev.push({ v: 'sample', bus: 'fx', id: 'pop-crash', t: end, gain: 0.35 });
    [62, 69, 74, 77, 81, 88].forEach((m, k) => ev.push({ v: 'bell', bus: 'lead', t: end + k * 0.03, midi: m, dur: tail - k * 0.03, vel: 0.65, gain: 0.2, pan: (k - 2.5) / 3 }));
    [50, 57, 62, 65].forEach((m, k) => ev.push({ v: 'synth', osc: 'tri', bus: 'pads', t: end, midi: m, dur: tail, vel: 0.6, cutoff: 2200, amp: { a: 0.03, d: 1.5, s: 0.7, r: 0.4 }, gain: 0.12, pan: (k - 1.5) / 2 }));
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 0.65, hp: 30, comp: { threshold: 0.45, ratio: 4, attack: 0.003, release: 0.08 }, reverb: 0.05 },
      bass: { gain: 1, hp: 35, lp: 2500, duck: { depth: 0.35, attack: 0.003, release: beat * 0.4 } },
      keys: { gain: 1, hp: 200, lp: 6000, reverb: 0.15, delay: 0.12, width: 1.2 },
      lead: { gain: 1, hp: 300, reverb: 0.22, delay: 0.1 },
      pads: { gain: 1, hp: 120, reverb: 0.3 },
      fx: { gain: 1, hp: 25, reverb: 0.15 },
    },
    reverb: { size: 0.45, damp: 0.5, width: 1, predelay: 0.012, lowCut: 350, highCut: 8000, gain: 1 },
    delay: { left: beat * 0.5, right: beat * 0.75, feedback: 0.25, damp: 3500, gain: 1 },
    glue: { threshold: 0.45, ratio: 2.5, attack: 0.008, release: 0.12 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const minimalPop: Preset = { bpm: [100, 130], arrange };
