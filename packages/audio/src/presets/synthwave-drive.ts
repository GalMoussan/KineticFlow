/**
 * synthwave-drive (100–130 bpm), for neon: Am–F–C–G in the spirit of OpenKatana's `make_score9.py`.
 *
 * - Four-on-the-floor kick (sample + sine boom layer), snare+clap on 2 and 4, off-beat hats with a 16th push at the
 *   end of each bar, a crash on the first landing of each new section.
 * - Driving 8th-note saw bass (octave every 4th 8th) and a detuned supersaw pad, both pumped by the kick.
 * - A 16th square-wave arpeggio through the chord tones with a dotted-8th ping-pong delay; it keeps running under
 *   the teaser breakdown while the drums and bass drop out and a riser builds into the next section.
 * - Every landing gets a short saw pluck on a chord tone; emphasised landings get a big impact (sub boom, crash,
 *   noise burst, sparkle). Camera moves get a reversed crash swell.
 * - Ending: Am(add9) supersaw chord + bell arpeggio + low boom, fading by the end of the video.
 */
import type { CueSheet } from '@reel/core';
import type { MusicEvent } from '../voices.ts';
import { kick, plan, type Preset, type PresetMusic } from './plan.ts';

/** root, fifth, octave, third, top (as in make_score9). */
const CHORDS = {
  Am: [45, 52, 57, 60, 64],
  F: [41, 48, 53, 57, 60],
  C: [48, 55, 60, 64, 67],
  G: [43, 50, 55, 59, 62],
} as const;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Am', 'F', 'C', 'G'];

function arrange(sheet: CueSheet, music: PresetMusic) {
  const p = plan(sheet, music);
  const { beat, bar, t0, end } = p;
  const ev: MusicEvent[] = [];
  const kicks: number[] = [];
  const chordAt = (t: number): Chord => (t >= end - 1e-9 ? 'Am' : PROG[Math.max(0, p.barAt(t)) % 4]!);
  const breakdown = (t: number) => p.inTeaser(t);

  // Drums.
  const beats = Math.floor((end - t0) / beat + 1e-9);
  for (let k = 0; k < beats; k++) {
    const t = p.at(k);
    if (breakdown(t)) continue;
    kick(ev, t, 'e-kick', 0.85, 0.85, 0.09);
    kicks.push(t);
    if (k % 2 === 1 && k >= 4) {
      ev.push({ v: 'sample', bus: 'drums', id: 'e-snare', t, gain: 0.45, pan: 0.04 });
      ev.push({ v: 'sample', bus: 'drums', id: 'e-clap', t, gain: 0.35, pan: -0.06 });
    }
    for (const h of k % 4 === 3 ? [0.5, 0.75] : [0.5]) {
      ev.push({ v: 'sample', bus: 'drums', id: 'e-hat', t: p.at(k + h), gain: h === 0.5 ? 0.22 : 0.14, pan: 0.3 });
    }
  }
  // Crash on the first landing of each section after the title (not under the breakdown).
  const seen = new Set<string>();
  for (const l of p.lands) {
    if (seen.has(l.section)) continue;
    seen.add(l.section);
    if (l.index > 0 && !breakdown(l.t)) ev.push({ v: 'sample', bus: 'drums', id: 'e-crash', t: l.t, gain: 0.3, pan: -0.2 });
  }

  // Bass and pads, bar by bar.
  for (let b = 0; b < p.bars; b++) {
    const tb = p.at(b * 4);
    if (tb >= end - 1e-9) break;
    const [root, , octave, third, top] = CHORDS[chordAt(tb)];
    const len = Math.min(bar, end - tb);
    const bd = breakdown(tb) || breakdown(tb + bar / 2);
    for (const [j, m] of [octave, third, top].entries()) {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: tb, midi: m, dur: len, vel: 0.7, cutoff: bd ? 3200 : 1900, reso: 0.8, detune: 24, width: 0.9, amp: { a: 0.18, d: 0.6, s: 0.85, r: 0.35 }, gain: 0.17, pan: (j - 1) * 0.3 });
    }
    if (bd) {
      ev.push({ v: 'sub', bus: 'bass', t: tb, midi: root, dur: len * 0.9, release: len * 0.1, gain: 0.25 });
      continue;
    }
    for (let e = 0; e < 8; e++) {
      const t = p.at(b * 4 + e / 2);
      if (t >= end - 1e-9) break;
      // Octave pump on the roots (87–131 Hz) with no sub layer: the kick's boom owns the band below 60 Hz.
      const m = e % 4 === 3 ? root + 12 : root;
      ev.push({ v: 'synth', osc: 'saw', bus: 'bass', t, midi: m, dur: beat * 0.42, vel: e % 2 ? 0.7 : 0.9, cutoff: 420, reso: 1.1, envAmt: 3, fenv: { a: 0.001, d: 0.13, s: 0, r: 0.05 }, amp: { a: 0.002, d: 0.25, s: 0.75, r: 0.04 }, drive: 1.6, gain: 0.55 });
    }
  }

  // 16th arpeggio (runs through the breakdown).
  const step = beat / 4;
  for (let s = 0; ; s++) {
    const t = p.at(s / 4);
    if (t >= end - 1e-9) break;
    const [, fifth, octave, third, top] = CHORDS[chordAt(t)];
    const pattern = [octave + 12, third + 12, fifth + 24, top + 12, third + 24, fifth + 24, top + 12, third + 12];
    ev.push({ v: 'synth', osc: 'square', pw: 0.32, bus: 'lead', t, midi: pattern[s % 8]!, dur: step * 0.7, vel: s % 4 === 0 ? 0.85 : 0.6, cutoff: 1400, reso: 1.4, envAmt: 2.5, fenv: { a: 0.001, d: 0.09, s: 0.1, r: 0.04 }, amp: { a: 0.001, d: 0.12, s: 0.35, r: 0.05 }, gain: s % 4 === 0 ? 0.22 : 0.17, pan: -0.45 + ((s % 8) / 7) * 0.9 });
  }

  // Landings: pluck; emphasis: impact.
  const hits = [...p.lands.map((l) => ({ t: l.t, emph: l.emph, w: l.weight })), ...p.accents.map((t) => ({ t, emph: true, w: 1 }))].sort((a, b) => a.t - b.t);
  hits.forEach(({ t, emph, w }, i) => {
    const [, fifth, , third, top] = CHORDS[chordAt(Math.max(t, t0))];
    const m = [top, third + 12, fifth + 12][i % 3]! + 12;
    ev.push({ v: 'synth', osc: 'saw', bus: 'lead', t, midi: m, dur: 0.12, vel: 0.6 + 0.4 * w, cutoff: 900, reso: 2, envAmt: 3.5, fenv: { a: 0.001, d: 0.15, s: 0, r: 0.1 }, amp: { a: 0.001, d: 0.3, s: 0, r: 0.2 }, gain: 0.32, pan: i % 2 ? 0.3 : -0.3, tag: 'land' });
    if (emph) {
      ev.push({ v: 'sub', bus: 'fx', t, midi: 28, drop: 12, dropTime: 0.08, dur: 0.7, decay: 0.9, release: 0.25, drive: 2, gain: 0.55 });
      ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t, gain: 0.32, pan: 0.15 });
      ev.push({ v: 'noise', bus: 'fx', t, dur: 0.35, filter: 'lp', f0: 9000, f1: 2000, a: 0.002, r: 0.32, gain: 0.25, salt: i });
      ev.push({ v: 'bell', bus: 'lead', t, midi: 88, dur: 0.6, vel: 0.7, gain: 0.18, pan: -0.25 });
    }
  });

  // Camera moves: reversed crash swell + filtered noise up into the arrival.
  p.moves.forEach((mv, i) => {
    const len = Math.max(0.15, mv.until - mv.t);
    ev.push({ v: 'sample', bus: 'fx', id: 'e-crash', t: mv.t, len, reverse: true, gain: 0.3, pan: i % 2 ? 0.3 : -0.3 });
    ev.push({ v: 'noise', bus: 'fx', t: mv.t, dur: len, filter: 'hp', f0: 500, f1: 6000, a: len * 0.9, curve: 2, r: 0.03, gain: 0.2, pan: i % 2 ? -0.5 : 0.5, panTo: i % 2 ? 0.5 : -0.5, salt: 50 + i });
  });
  // Breakdown riser into the next section.
  if (p.teaser) {
    const [a, b] = p.teaser;
    ev.push({ v: 'noise', bus: 'fx', t: a, dur: b - a, filter: 'bp', f0: 300, f1: 6000, q: 1.2, a: (b - a) * 0.95, curve: 2.2, r: 0.04, gain: 0.3, salt: 99 });
  }

  // Ending.
  const tail = p.dur - end;
  if (tail > 0.05) {
    for (const [j, m] of [57, 60, 64, 71].entries()) {
      ev.push({ v: 'synth', osc: 'supersaw', bus: 'pads', t: end, midi: m, dur: tail, vel: 0.8, cutoff: 2600, detune: 26, width: 1, amp: { a: 0.02, d: 1, s: 0.8, r: 0.3 }, gain: 0.18, pan: (j - 1.5) * 0.25 });
    }
    [69, 76, 81, 84].forEach((m, j) => ev.push({ v: 'bell', bus: 'lead', t: end + j * 0.09, midi: m, dur: Math.min(2, tail), vel: 0.7, gain: 0.2, pan: (j - 1.5) / 2 }));
    ev.push({ v: 'sub', bus: 'bass', t: end, midi: 33, drop: 12, dropTime: 0.08, dur: tail * 0.85, release: tail * 0.15, decay: 2.2, gain: 0.5 });
    kick(ev, end, 'e-kick', 0.9, 0.85, 0.09);
    ev.push({ v: 'sample', bus: 'drums', id: 'e-crash', t: end, gain: 0.35 });
  }

  return {
    duration: p.dur,
    events: ev,
    kicks,
    buses: {
      drums: { gain: 1, hp: 30, comp: { threshold: 0.4, ratio: 3, attack: 0.005, release: 0.1 }, drive: 1.3, reverb: 0.1 },
      bass: { gain: 1, hp: 30, lp: 3000, duck: { depth: 0.55, attack: 0.004, release: beat * 0.6 } },
      pads: { gain: 1, hp: 180, chorus: { rate: 0.25, depth: 0.003, delay: 0.014, mix: 0.3 }, duck: { depth: 0.6, attack: 0.006, release: beat * 0.8 }, reverb: 0.3, width: 1.3 },
      lead: { gain: 1, hp: 250, reverb: 0.25, delay: 0.32 },
      fx: { gain: 0.6, hp: 25, reverb: 0.3 },
    },
    reverb: { size: 0.8, damp: 0.4, width: 1, predelay: 0.025, lowCut: 300, highCut: 8000, gain: 1 },
    delay: { left: beat * 0.75, right: beat * 0.75, feedback: 0.38, damp: 4000, pingPong: true, gain: 1, reverb: 0.25 },
    glue: { threshold: 0.45, ratio: 2, attack: 0.01, release: 0.15 },
    fade: p.fade,
    rmsDb: -20,
  };
}

export const synthwaveDrive: Preset = { bpm: [100, 130], arrange };
