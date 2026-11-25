/**
 * Sound effects driven by what the page animates (`ReelPage.soundCues()`, PLAN.md §8.2). Every `SoundKind` is a
 * small designed patch of engine voices; each cue starts exactly on its sample (`round(t · sr)`) and nothing sounds
 * before it. Variation (pitch, filter, length, sweep direction) is seeded per cue index, so repeats differ while the
 * stem stays a pure function of the cues and the seed. Weight maps to gain as weight^1.5; `pan` places the sound.
 */
import type { SoundCue, SoundKind } from '@reel/core';
import { renderArrangement, type Arrangement } from './engine.ts';
import { mulberry32, subSeed } from './rng.ts';
import { kitSample } from './samples.ts';
import { SAMPLE_RATE, type SampleBank, type Stereo } from './types.ts';
import type { MusicEvent } from './voices.ts';
import { pow } from './dmath.ts';

/** Default lengths for sustained kinds whose cue has no `until`. */
const DEFAULT_LEN: Partial<Record<SoundKind, number>> = { whoosh: 0.45, riser: 1.2, swipe: 0.3, scribble: 0.8 };
/**
 * Stem level: a weight-1 hit peaks around −6 dBFS, which sits on the music stem (≈ −20 dBFS RMS) like a produced
 * accent: short-term loudness within a few LU of the music, never dominating it.
 */
const LEVEL = 0.5;
/** A major-pentatonic set for tonal accents (C major, around C6). */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

type Rand = () => number;

function patch(c: SoundCue, i: number, rnd: Rand, gain: number): MusicEvent[] {
  const t = c.t;
  const pan = c.pan ?? 0;
  const pitch = c.pitch ?? 0;
  const len = Math.max(0.05, c.until !== undefined ? c.until - c.t : (DEFAULT_LEN[c.kind] ?? 0.3));
  const vary = (amount: number) => 1 + (rnd() * 2 - 1) * amount;
  const dir = rnd() < 0.5 ? -1 : 1;
  switch (c.kind) {
    case 'whoosh':
      return [
        { v: 'noise', bus: 'fx', t, dur: len + 0.08, color: 'pink', filter: 'bp', f0: 350 * vary(0.2), f1: 3800 * vary(0.25), q: 1.1, a: len * 0.75, curve: 2, r: len * 0.25 + 0.08, gain: gain * 0.9, pan: pan - 0.6 * dir, panTo: pan + 0.6 * dir, salt: i },
        { v: 'noise', bus: 'fx', t, dur: len + 0.08, filter: 'hp', f0: 3000 * vary(0.2), f1: 7000, a: len * 0.85, curve: 3, r: len * 0.15 + 0.08, gain: gain * 0.25, pan: pan - 0.4 * dir, panTo: pan + 0.4 * dir, salt: i + 7919 },
      ];
    case 'impact':
      return [
        { v: 'sub', bus: 'drums', t, midi: 29 + Math.round((rnd() * 2 - 1) * 2) + pitch, drop: 14, dropTime: 0.07, dur: 0.45, decay: 0.55, release: 0.25, drive: 1.8, gain: gain * 0.9, pan },
        { v: 'sample', bus: 'drums', id: 'pop-kick', t, gain: gain * 0.55, pan, semi: -2 + (rnd() * 2 - 1) },
        { v: 'noise', bus: 'drums', t, dur: 0.18 * vary(0.2), filter: 'bp', f0: 2600 * vary(0.25), f1: 1200, q: 0.8, a: 0.001, r: 0.16, gain: gain * 0.7, pan, salt: i },
        { v: 'noise', bus: 'fx', t, dur: 0.5, color: 'pink', filter: 'lp', f0: 6000, f1: 1500, a: 0.002, r: 0.45, gain: gain * 0.18, pan, salt: i + 31 },
      ];
    case 'pop': {
      const m = 74 + pitch + Math.round((rnd() * 2 - 1) * 1.5);
      return [
        { v: 'sub', bus: 'drums', t, midi: m, drop: 9, dropTime: 0.018, dur: 0.035, release: 0.05, gain: gain * 0.55, pan },
        { v: 'noise', bus: 'drums', t, dur: 0.008, filter: 'hp', f0: 4500, a: 0.0005, r: 0.006, gain: gain * 0.35, pan, salt: i },
      ];
    }
    case 'tick': {
      const f = 2600 * pow(2, pitch / 12) * vary(0.04);
      return [
        { v: 'noise', bus: 'drums', t, dur: 0.014, filter: 'bp', f0: f, q: 5, a: 0.0004, r: 0.012, gain: gain * 1.4, pan, salt: i },
        { v: 'bell', kind: 'glass', bus: 'drums', t, midi: 96 + pitch, dur: 0.025, vel: 0.6, gain: gain * 0.25, pan },
      ];
    }
    case 'riser':
      return [
        { v: 'noise', bus: 'fx', t, dur: len + 0.03, filter: 'bp', f0: 300 * vary(0.15), f1: 7000 * vary(0.15), q: 1.4, a: len, curve: 2.5, r: 0.03, gain: gain * 0.8, pan, salt: i },
        { v: 'sub', bus: 'fx', t, midi: 84 + pitch, drop: -24, dropTime: len * 1.3, dur: len, release: 0.03, gain: gain * 0.06, pan },
        { v: 'sample', bus: 'fx', id: 'fx-cymbal', t, len, reverse: true, gain: gain * 0.35, pan },
      ];
    case 'shimmer': {
      const base = 84 + pitch;
      const start = Math.floor(rnd() * 3);
      const out: MusicEvent[] = [0, 1, 2, 3].map((k) => ({
        v: 'bell' as const,
        kind: 'glass' as const,
        bus: 'lead' as const,
        t: t + k * 0.028,
        midi: base + PENTA[start + k]!,
        dur: 0.6,
        vel: 0.7,
        gain: gain * (0.32 - k * 0.05),
        pan: pan + (k - 1.5) * 0.2 * dir,
      }));
      out.push({ v: 'sample', bus: 'lead', id: 'fx-glass', t, semi: 5 + (rnd() * 2 - 1) * 2, gain: gain * 0.25, pan });
      out.push({ v: 'noise', bus: 'lead', t, dur: 0.35, filter: 'hp', f0: 8000, a: 0.002, r: 0.3, gain: gain * 0.12, pan, salt: i });
      return out;
    }
    case 'swipe':
      return [
        { v: 'noise', bus: 'fx', t, dur: len, filter: 'bp', f0: 1700 * vary(0.15), f1: 3400 * vary(0.15), q: 2.2, a: Math.min(0.03, len * 0.3), r: len * 0.55, gain: gain * 0.9, pan: pan - 0.3 * dir, panTo: pan + 0.3 * dir, salt: i },
        { v: 'noise', bus: 'fx', t, dur: len, color: 'pink', filter: 'lp', f0: 900, a: Math.min(0.02, len * 0.2), r: len * 0.5, gain: gain * 0.35, pan, salt: i + 101 },
      ];
    case 'stinger': {
      const root = 72 + pitch;
      const out: MusicEvent[] = [
        { v: 'sub', bus: 'drums', t, midi: 26 + pitch, drop: 12, dropTime: 0.08, dur: 0.9, decay: 1.1, release: 0.6, drive: 1.5, gain: gain * 0.8, pan },
        { v: 'sample', bus: 'drums', id: 'e-crash', t, gain: gain * 0.35, pan },
        { v: 'sample', bus: 'lead', id: 'fx-bowl', t, semi: pitch, gain: gain * 0.3, pan },
      ];
      [0, 7, 12, 16, 19].forEach((d, k) => out.push({ v: 'bell', bus: 'lead', t: t + k * 0.03, midi: root + d, dur: 1.6, vel: 0.75, gain: gain * 0.28, pan: pan + (k - 2) * 0.25 }));
      return out;
    }
    case 'scribble': {
      // pen on paper: a soft paper hiss under grainy strokes (short band-passed bursts, one per pen move), all under a
      // span envelope (quick rise, steady, a fade over the last quarter)
      const env = (u: number) => Math.max(0.25, Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.25));
      const out: MusicEvent[] = [
        { v: 'noise', bus: 'fx', t, dur: len, color: 'pink', filter: 'bp', f0: 2200 * vary(0.1), f1: 2600 * vary(0.1), q: 0.9, a: Math.min(0.08, len * 0.2), r: Math.min(0.2, len * 0.3), gain: gain * 0.22, pan, salt: i },
      ];
      let at = 0;
      for (let k = 0; at < len - 0.04 && k < 48; k++) {
        const g = Math.min(0.05 + rnd() * 0.12, len - at);
        out.push({
          v: 'noise', bus: 'fx', t: t + at, dur: g, filter: 'bp', f0: 1700 + rnd() * 2600, f1: 1500 + rnd() * 2900, q: 2.4,
          a: 0.006, r: g * 0.6, gain: gain * 0.6 * env(at / len) * vary(0.25), pan: pan + (rnd() * 2 - 1) * 0.12, salt: i * 97 + k + 1,
        });
        at += g + rnd() * 0.05;
      }
      return out;
    }
  }
}

export interface SfxOptions {
  duration: number;
  seed: number;
  samples: SampleBank;
  sampleRate?: number;
}

/** Renders the SFX stem for `cues` (any order; rendered sorted by time, ties in input order). */
export function renderSfx(cues: SoundCue[], o: SfxOptions): Stereo {
  const sr = o.sampleRate ?? SAMPLE_RATE;
  const events: MusicEvent[] = [];
  cues.forEach((c, i) => {
    if (c.t < 0 || c.t >= o.duration) return;
    const w = c.weight < 0 ? 0 : c.weight > 1 ? 1 : c.weight;
    if (w === 0) return;
    const rnd = mulberry32(subSeed(o.seed, i));
    events.push(...patch(c, i, rnd, pow(w, 1.5) * LEVEL));
  });
  const a: Arrangement = {
    duration: o.duration,
    events,
    kicks: [],
    buses: {
      drums: { gain: 1, hp: 25, reverb: 0.1 },
      fx: { gain: 1, hp: 60, reverb: 0.15 },
      lead: { gain: 1, hp: 400, reverb: 0.4 },
    },
    reverb: { size: 0.45, damp: 0.5, width: 1, predelay: 0.01, lowCut: 300, highCut: 9000, gain: 1 },
    delay: { left: 0.25, right: 0.25, feedback: 0, damp: 4000, gain: 0 },
  };
  return renderArrangement(a, { sampleRate: sr, seed: o.seed, sample: (id) => kitSample(o.samples, id) });
}
