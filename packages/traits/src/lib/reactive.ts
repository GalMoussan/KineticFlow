/**
 * Page-side band envelopes for audio-reactive traits: `REEL.cues.envelopes` (per-frame 0..1 from `@reel/audio`
 * `computeEnvelopes`), or, when the job has none, envelopes synthesised from the beat grid (kicks on beats, louder on
 * downbeats; hats on the off-beats), so a reactive style still moves to the music's grid. Each band is smoothed with
 * an instant attack and an exponential release (`decay` 1/s): `s[i] = max(e[i], s[i−1]·e^(−decay/fps))`.
 *
 * Tables are built once per decay, before any frame, so reading them is a pure function of t; values are rounded to
 * 1e-4 and are exactly what a trait's `fingerprint()` reports.
 */
import type { Band, CueSheet } from '@reel/core';

export type Envelopes = Record<Band, number[]>;

export interface Reactive {
  /** `envelopes`: from the music stem; `grid`: synthesised from beats/downbeats. */
  source: 'envelopes' | 'grid';
  fps: number;
  /** Smoothed bands, one value per video frame. */
  bands: Envelopes;
}

const BAND_IDS: Band[] = ['sub', 'bass', 'mid', 'high', 'onset'];
const cache = new Map<number, Reactive>();

/** Beat-grid stand-in: what a four-on-the-floor arrangement on this grid would roughly measure. */
function fromGrid(cues: CueSheet): Envelopes {
  const { beats, fps, frames } = cues;
  const down = new Set(cues.downbeats);
  const out = Object.fromEntries(BAND_IDS.map((b) => [b, new Array<number>(frames).fill(0)])) as Envelopes;
  let j = -1;
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    while (j + 1 < beats.length && beats[j + 1]! <= t + 1e-9) j++;
    if (j < 0) continue;
    const b = beats[j]!;
    const len = (beats[j + 1] ?? b + (j > 0 ? b - beats[j - 1]! : 0.5)) - b;
    const age = t - b;
    const accent = down.has(b) ? 1 : 0.78;
    const off = age - len / 2;
    out.sub[i] = accent * Math.exp(-age * 9);
    out.bass[i] = accent * Math.exp(-age * 7);
    out.mid[i] = 0.35 + 0.4 * Math.exp(-age * 4);
    out.high[i] = off >= 0 ? 0.65 * Math.exp(-off * 16) : 0.25 * Math.exp(-age * 16);
    out.onset[i] = Math.exp(-age * 20);
  }
  return out;
}

/** The smoothed band tables of this job for release `decay` (1/s). */
export function reactive(cues: CueSheet, decay: number): Reactive {
  let r = cache.get(decay);
  if (r) return r;
  const raw = cues.envelopes;
  const src = raw ?? fromGrid(cues);
  const k = Math.exp(-decay / cues.fps);
  const bands = Object.fromEntries(
    BAND_IDS.map((b) => {
      const e = src[b];
      const s = new Array<number>(e.length);
      let prev = 0;
      for (let i = 0; i < e.length; i++) {
        prev = Math.round(Math.max(e[i]!, prev * k) * 1e4) / 1e4;
        s[i] = prev;
      }
      return [b, s];
    }),
  ) as Envelopes;
  r = { source: raw ? 'envelopes' : 'grid', fps: cues.fps, bands };
  cache.set(decay, r);
  return r;
}

/** Frame index of t (frame times are i/fps; sub-frame samples belong to their frame). */
export const frameOf = (r: Reactive, t: number): number => Math.floor(t * r.fps + 1e-6);

/** Band value at t (0 before the start, the last frame's value after the end). */
export function level(r: Reactive, band: Band, t: number): number {
  const a = r.bands[band];
  if (!a.length) return 0;
  const i = frameOf(r, t);
  return i < 0 ? 0 : a[i < a.length ? i : a.length - 1]!;
}

/** The frames of `bands` that can be read for t ∈ [t0, t1] (what a fingerprint must cover). */
export function slice(r: Reactive, bands: readonly Band[], t0: number, t1: number): Partial<Envelopes> & { from: number } {
  const from = Math.max(0, frameOf(r, t0));
  const to = frameOf(r, t1) + 1;
  const out: Partial<Envelopes> & { from: number } = { from };
  for (const b of bands) {
    const a = r.bands[b];
    // reads past the end return the last frame
    out[b] = from >= a.length ? a.slice(-1) : a.slice(from, Math.min(to, a.length));
  }
  return out;
}
