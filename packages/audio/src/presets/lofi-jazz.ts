/**
 * Mellow lo-fi jazz score, ported from OpenKatana's `make_score11.py` (Dilemma Cafe reel #11) and driven by the
 * cue sheet instead of hard-coded times.
 *
 * I-vi-ii-V in D major (Dmaj9 - Bm9 - Em9 - A13) on an electric-piano voice (sine + triangle + faint bell tine),
 * round sine bass, soft kick, brushed-noise snare, swung hats, vinyl crackle, a bell pluck on every landing (two-note
 * pluck on emphasis), soft whooshes under camera moves, the kick dropping out under the teaser, and a resolving
 * Dmaj9 chord at the end. Bars count from the first downbeat `t0`, so the arrangement follows any bpm.
 */
import type { CueSheet } from '@reel/core';
import { mulberry32, type NoteEvent, type ScoreDocument, type Waveform } from '../synth.ts';

export interface PresetMusic {
  bpm: number;
  seed: number;
}

/** Swung 8th offbeat position (fraction of a beat). */
const SWING = 0.58;
/** Bass root, e-piano voicing. */
const CHORDS = {
  Dmaj9: [38, [54, 57, 61, 64]],
  Bm9: [35, [57, 61, 62, 66]],
  Em9: [40, [55, 59, 62, 66]],
  A13: [33, [55, 61, 66, 71]],
} as const satisfies Record<string, readonly [number, readonly number[]]>;
type Chord = keyof typeof CHORDS;
const PROG: readonly Chord[] = ['Dmaj9', 'Bm9', 'Em9', 'A13'];
/** Absorbs float error in grid arithmetic (`(t - T0) / BAR` for t on the grid). */
const EPS = 1e-9;

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function lofiJazz(sheet: CueSheet, music: PresetMusic, sampleRate = 48000): ScoreDocument {
  const DUR = sheet.duration;
  const BEAT = 60 / music.bpm;
  const T0 = sheet.t0;
  const BAR = BEAT * 4;

  // Word landings: the opening/closing decorations (quote marks) land as emphasised words, like the reference.
  const emphasis = new Set(sheet.cues.filter((c) => c.type === 'emphasis').map((c) => `${c.section}#${c.unit}`));
  const words: Array<[number, boolean]> = [];
  for (const c of sheet.cues) {
    if (c.type === 'land') words.push([c.t, emphasis.has(`${c.section}#${c.unit}`)]);
    else if (c.type === 'intro' || c.type === 'outro') words.push([c.t, true]);
  }
  const moves = sheet.cues.filter((c) => c.type === 'camera-move').map((c) => [c.t, c.until ?? c.t] as const);
  const teaser = sheet.sections.find((s) => s.role === 'teaser');
  const surprise = teaser ? ([teaser.timing.firstLand, teaser.timing.out] as const) : null;
  const lands = sheet.cues.filter((c) => c.type === 'land');
  const outro = sheet.cues.find((c) => c.type === 'outro');
  let END: number;
  if (outro) END = outro.t;
  else {
    const after = (lands.at(-1)?.t ?? T0) + BEAT;
    END = sheet.beats.find((b) => b >= after - EPS) ?? T0 + Math.ceil((after - T0) / BEAT - EPS) * BEAT;
  }
  /** The bar sounding just before END plays the V chord. */
  const lastBar = Math.ceil((END - T0) / BAR - EPS) - 1;

  const notes: NoteEvent[] = [];
  const add = (at: number, dur: number, waveform: Waveform, gain: number, midi: number, attack: number, release: number, pan = 0) => {
    notes.push({ at: round4(at), duration: round4(dur), waveform, gain, midi, attack, release, pan });
  };

  const chordAt = (t: number): Chord => {
    if (t >= END) return 'Dmaj9';
    const bar = Math.floor((t - T0) / BAR + EPS);
    if (bar === lastBar) return 'A13';
    return PROG[Math.max(bar, 0) % 4]!;
  };

  const epiano = (at: number, dur: number, midis: readonly number[], gain: number, release: number) => {
    midis.forEach((m, j) => {
      const pan = (j - (midis.length - 1) / 2) * 0.28;
      const roll = j * 0.012;
      add(at + roll, dur, 'sine', gain, m, 0.012, release, pan);
      add(at + roll, dur, 'triangle', gain * 0.22, m, 0.015, release * 0.8, pan);
      add(at + roll, Math.min(dur, 0.5), 'bell', gain * 0.16, m + 12, 0.002, 0.45, pan);
    });
  };

  const intro = () => {
    // Pickup chord before the opening decoration lands: a single soft e-piano swell.
    const at = Math.max(0.02, T0 - 0.48);
    if (T0 - at > 0.05) epiano(at, T0 - at, CHORDS.Dmaj9[1], 0.022, 0.2);
  };

  const keysAndBass = () => {
    for (let bar = 0; T0 + bar * BAR < END; bar++) {
      const t0 = T0 + bar * BAR;
      const [root, voicing] = CHORDS[chordAt(t0)];
      // Comping: long chord on 1, short push on the "and" of 2, soft re-touch on 4.
      for (const [b, length, g] of [[0, 1.6, 0.05], [1 + SWING, 0.7, 0.036], [3, 0.8, 0.028]] as const) {
        const at = t0 + b * BEAT;
        if (at >= END) break;
        const dur = Math.min(length * BEAT, END - at + 0.05);
        epiano(at, dur, voicing, g, Math.min(0.5, dur * 0.6));
      }
      // Round bass: root on 1, fifth pickup on the swung "and" of 2, root on 3, octave approach on 4-and.
      const line = [[0, root, 1.3], [1 + SWING, root + 7, 0.4], [2, root, 1.0], [3 + SWING, root + 12, 0.35]] as const;
      for (const [b, m, length] of line) {
        const at = t0 + b * BEAT;
        if (at >= END) break;
        add(at, length * BEAT, 'sine', 0.26, m, 0.008, length * BEAT * 0.55);
        add(at, length * BEAT * 0.6, 'triangle', 0.05, m + 12, 0.006, length * BEAT * 0.4);
      }
    }
  };

  const drums = () => {
    const beats = Math.floor((END - T0) / BEAT + EPS);
    for (let b = 0; b < beats; b++) {
      const t = T0 + b * BEAT;
      const inBar = b % 4;
      const quiet = surprise !== null && surprise[0] <= t && t < surprise[1];
      const first = t < T0 + BAR - EPS; // first bar: brushes + hats only
      if (!quiet && !first && (inBar === 0 || inBar === 2)) {
        add(t, 0.24, 'sine', 0.42, 33, 0.003, 0.2); // soft kick body
        add(t, 0.05, 'sine', 0.12, 45, 0.002, 0.04); // knock
      }
      if (!quiet && !first && inBar === 1 && Math.floor(b / 4) % 2 === 1) {
        add(t + SWING * BEAT, 0.2, 'sine', 0.26, 33, 0.003, 0.17); // ghost kick
      }
      if (inBar === 1 || inBar === 3) {
        const g = quiet ? 0.06 : 0.1;
        add(t - 0.12, 0.2, 'noise', g * 0.35, 60, 0.15, 0.04, -0.1); // brush sweep
        add(t, 0.26, 'noise', g, 60, 0.006, 0.24, -0.1); // brushed snare
      }
      for (const [off, g] of [[0, 0.03], [SWING, 0.022]] as const) {
        add(t + off * BEAT, 0.035, 'noise', g * (quiet ? 0.6 : 1), 60, 0.001, 0.03, 0.35); // swung hats
      }
    }
  };

  const plucks = () => {
    words.forEach(([t, emph], i) => {
      const voicing = CHORDS[chordAt(Math.max(t, T0))][1];
      const m = voicing[i % voicing.length]! + 12;
      const pan = i % 2 ? -0.35 : 0.35;
      add(t, 0.7, 'bell', 0.075, m, 0.002, 0.6, pan);
      if (emph) {
        add(t + 0.03, 0.8, 'bell', 0.05, m + 7 <= 84 ? m + 7 : m - 5, 0.002, 0.7, -pan);
        add(t, 0.35, 'sine', 0.06, m - 12, 0.004, 0.3);
      }
    });
  };

  const whooshes = () => {
    for (const [a, b] of moves) {
      const length = b - a;
      add(a, length + 0.1, 'noise', 0.045, 60, length * 0.75, 0.12);
      add(a + length * 0.5, length * 0.5 + 0.1, 'sine', 0.02, 81, length * 0.4, 0.1);
    }
  };

  const crackle = () => {
    const rnd = mulberry32((music.seed + 0x9e3779b9) >>> 0);
    for (let t = 0.05; t < DUR - 0.3; t += 0.06 + rnd() * 0.26) {
      const gain = 0.012 + rnd() * 0.03;
      add(t, 0.006, 'noise', gain, 60, 0.001, 0.004, -0.6 + rnd() * 1.2);
    }
    add(0, DUR, 'noise', 0.006, 60, 0.4, 2.0); // faint tape hiss bed
  };

  const ending = () => {
    const [root] = CHORDS.Dmaj9;
    [50, 54, 57, 61, 64, 69].forEach((m, k) => {
      const at = END + k * 0.05;
      add(at, DUR - at, 'sine', 0.045, m, 0.02, 2.4, (k - 2.5) / 4);
      add(at, DUR - at, 'triangle', 0.01, m, 0.03, 2.2, (k - 2.5) / 4);
    });
    [73, 76, 78, 81].forEach((m, k) => add(END + 0.25 + k * 0.18, 1.8, 'bell', 0.04, m, 0.002, 1.6, 0.4 - k * 0.25));
    add(END, DUR - END, 'sine', 0.3, root, 0.01, 2.5);
    add(END, 0.3, 'sine', 0.32, 33, 0.003, 0.27); // last soft kick
    add(END, 0.5, 'noise', 0.05, 60, 0.01, 0.45); // soft brush cymbal
  };

  intro();
  keysAndBass();
  drums();
  plucks();
  whooshes();
  crackle();
  ending();
  return { duration: DUR, sample_rate: sampleRate, seed: music.seed % 2 ** 32, notes: clamp(notes, DUR) };
}

/**
 * Fits notes into [0, DUR]: trims durations, drops notes shorter than the synth minimum (5 ms), rescales
 * attack+release that no longer fit, and sorts by start (stable).
 */
function clamp(ns: NoteEvent[], DUR: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const src of ns) {
    const n = { ...src };
    n.at = Math.max(0, n.at);
    n.duration = round4(Math.min(n.duration, DUR - n.at));
    if (n.duration < 0.005) continue;
    const a = n.attack ?? 0;
    const r = n.release ?? 0;
    if (a + r > n.duration) {
      const scale = (n.duration / (a + r)) * 0.98;
      n.attack = round4(a * scale);
      n.release = round4(r * scale);
    }
    out.push(n);
  }
  return out.sort((x, y) => x.at - y.at);
}
