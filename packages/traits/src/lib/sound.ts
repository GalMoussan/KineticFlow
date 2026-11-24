/**
 * Sound-cue helpers shared by the host and the traits' `sounds` hooks (README §7a). Page-side code: the cues are a
 * pure function of `REEL` (computed once after mount), so the SFX stem rendered from them is deterministic.
 */
import type { SoundCue, SoundKind } from '@reel/core';
import type { Section, Unit } from '../contract.ts';

/** Thinning priority (lower survives): accents first, small detail sounds last. */
const RANK: Record<SoundKind, number> = { stinger: 0, impact: 1, whoosh: 2, riser: 3, shimmer: 4, swipe: 5, pop: 6, tick: 7 };
/** Most cues whose attacks fall inside any 1 s window. */
export const MAX_PER_SECOND = 6;
/** Two cues of one kind closer than this are one sound (the louder one, at the earlier time). */
const MERGE = 0.03;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number) => Math.round(v * 1e3) / 1e3;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The closing stinger on the last section when it is the end card (at its first landing, the `endcard` cue). */
export function endcardStinger(s: Section, weight = 0.9): SoundCue[] {
  return s.role === 'endcard' && !s.next ? [{ t: s.timing.firstLand, kind: 'stinger', weight }] : [];
}

/** Digit parts of a unit (odometer/slot columns). */
export const digitParts = (u: Unit) => u.parts.filter((p) => /\p{Nd}/u.test(p.text));

/** Loudness intent from a unit's size relative to the format: the hero of a 9:16 title ≈ 1. */
export const sizeWeight = (u: Unit, H: number, base = 0.45) => clamp(base + (u.font.size / H) * 2.2, 0, 1);

/**
 * Normalises (rounding, clamping to [0, duration)), merges same-kind doubles and thins to at most
 * `MAX_PER_SECOND` attacks in every 1 s window, keeping higher-priority (then louder, then earlier) cues. Sorted by
 * t, then priority. Deterministic: depends only on the input set. A non-finite `until`/`pan`/`pitch` (a trait's
 * 0/0, an `Infinity` window) is dropped rather than passed on: one NaN pan made the whole mix NaN and the encode
 * fail (M7, stacked-scroll).
 */
export function finishCues(raw: SoundCue[], duration: number): SoundCue[] {
  const norm = raw
    .filter((c) => Number.isFinite(c.t) && c.t >= 0 && c.t < duration && Number.isFinite(c.weight) && c.weight > 0)
    .map((c): SoundCue => {
      const out: SoundCue = { t: r4(c.t), kind: c.kind, weight: r3(clamp(c.weight, 0, 1)) };
      if (c.until !== undefined && Number.isFinite(c.until)) out.until = r4(clamp(Math.max(c.until, c.t), c.t, duration));
      if (c.pan !== undefined && Number.isFinite(c.pan)) out.pan = r3(clamp(c.pan, -1, 1));
      if (c.pitch !== undefined && Number.isFinite(c.pitch)) out.pitch = r3(c.pitch);
      if (c.section !== undefined) out.section = c.section;
      return out;
    })
    .sort((a, b) => a.t - b.t || RANK[a.kind] - RANK[b.kind] || b.weight - a.weight);

  const merged: SoundCue[] = [];
  const lastOf = new Map<SoundKind, SoundCue>();
  for (const c of norm) {
    const p = lastOf.get(c.kind);
    if (p && c.t - p.t < MERGE) {
      p.weight = Math.max(p.weight, c.weight);
      if (c.until !== undefined) p.until = Math.max(p.until ?? c.until, c.until);
      continue;
    }
    merged.push(c);
    lastOf.set(c.kind, c);
  }

  const byPriority = [...merged].sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.weight - a.weight || a.t - b.t);
  const kept: number[] = [];
  const keep = new Set<SoundCue>();
  for (const c of byPriority) {
    // densest 1 s window containing c, with c added
    const near = kept.filter((t) => t > c.t - 1 && t < c.t + 1);
    near.push(c.t);
    near.sort((a, b) => a - b);
    let worst = 0;
    for (let i = 0, j = 0; i < near.length; i++) {
      while (near[j]! <= near[i]! - 1) j++;
      if (near[j]! <= c.t && near[i]! >= c.t) worst = Math.max(worst, i - j + 1);
    }
    if (worst > MAX_PER_SECOND) continue;
    kept.push(c.t);
    keep.add(c);
  }
  return merged.filter((c) => keep.has(c));
}
