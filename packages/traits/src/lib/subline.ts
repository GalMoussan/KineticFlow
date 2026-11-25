/**
 * The small line under a section's big words (`kind: 'sub'`).
 * Size, preferred weight, and one light landing tick per sub word.
 * Arithmetic only: safe for Node tests and for the page.
 */
import type { SoundCue } from '@reel/core';

/** Sub size as a share of the largest big line, before the "never larger than the smallest" cap. */
export const SUB_OF_BIG = 0.38;
/** Preferred weight. `host.metrics` and the font assign clamp it to the face. */
export const SUB_WEIGHT = 500;

/** Sub words of a unit list, in order. */
export function subUnits<T extends { item: number; kind: string }>(units: readonly T[]): T[] {
  return units.filter((u) => u.item >= 0 && u.kind === 'sub');
}

/**
 * Relative size of the sub line. `bigFs` are the big rows' size factors.
 * About 38% of the largest big line, and never larger than the smallest.
 */
export function subScale(bigFs: readonly number[]): number {
  const fs = bigFs.filter((f) => f > 0);
  if (!fs.length) return SUB_OF_BIG;
  let minF = fs[0]!;
  let maxF = fs[0]!;
  for (const f of fs) {
    if (f < minF) minF = f;
    if (f > maxF) maxF = f;
  }
  const scaled = SUB_OF_BIG * maxF;
  return minF < scaled ? minF : scaled;
}

/** Size factors of the text rows already in a block list (packs and text rows; badges skipped). */
export function blockFs(blocks: readonly { kind: string; f?: number; row?: { kind: string; f: number } }[]): number[] {
  const fs: number[] = [];
  for (const b of blocks) {
    if (b.kind === 'pack' && b.f !== undefined) fs.push(b.f);
    else if (b.kind === 'row' && b.row?.kind === 'text') fs.push(b.row.f);
  }
  return fs;
}

/** Greedy line count of `widths` (logical order) at line width `maxW`; a word wider than `maxW` sits alone. */
function greedy(widths: readonly number[], gap: number, maxW: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [];
  let w = 0;
  widths.forEach((wi, i) => {
    if (line.length && w + gap + wi > maxW) {
      lines.push(line);
      line = [];
      w = 0;
    }
    w += (line.length ? gap : 0) + wi;
    line.push(i);
  });
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Balanced wrap of the sub words into as few lines as fit `maxW` (indices, logical order per line): the fewest lines
 * the greedy wrap needs, then the narrowest width that keeps that count, so lines come out near-equal instead of a
 * long line and a widow. `widths` and `gap` are in one unit (px or em at the sub size).
 */
export function wrapSub(widths: readonly number[], gap: number, maxW: number): number[][] {
  if (!widths.length) return [];
  const n = greedy(widths, gap, maxW).length;
  let lo = Math.max(...widths);
  let hi = Math.max(lo, maxW);
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (greedy(widths, gap, mid).length <= n) hi = mid;
    else lo = mid;
  }
  return greedy(widths, gap, hi);
}

/**
 * One light tick for sub word `i` (0-based among the section's sub words).
 * Null before 0.6 s. Weight rises 0.18 → 0.35; pitch rises by 2 up to 8.
 */
export function subLanding(t: number, i: number, pan?: number): SoundCue | null {
  if (!(t >= 0.6)) return null;
  const cue: SoundCue = {
    t,
    kind: 'tick',
    weight: Math.min(0.35, 0.18 + i * 0.03),
    pitch: Math.min(8, i * 2),
  };
  if (pan !== undefined) cue.pan = pan;
  return cue;
}
