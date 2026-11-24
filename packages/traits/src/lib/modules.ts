/**
 * Helpers of the dynamic-layout styles (grid-reflow, bento, versus-split, fluid-scale): ink-tight text placement,
 * colour picks for text on filled tiles, step interpolation for FLIP moves and the exit window of a section whose
 * next section starts another layer. Page-side (`Math.*` allowed); nothing here runs in the resolver.
 */
import { visualOrder } from '@reel/runtime';
import type { SoundCue } from '@reel/core';
import type { Host, Layer, Metrics, Section, Unit } from '../contract.ts';
import { rgbOf } from './neon.ts';

/** Unit box padding around the ink, em. */
export const PAD_X = 0.06;
export const PAD_Y = 0.1;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `w` clamped to the font's weight range (static fonts have exactly one weight). */
export function fontWeight(host: Host, w: number, family: 'display' | 'text' = 'display'): number {
  const [lo, hi] = host.reel.fonts[family].weights;
  return w < lo ? lo : w > hi ? hi : w;
}

/** Ink width / height per px of font size. */
export const inkW = (m: Metrics) => m.bl + m.br;
export const inkH = (m: Metrics) => m.ia + m.id;

/**
 * Typesets `u` at size S so that its ink's top-left corner is at (x, y) in group coordinates (the kinetic-quote
 * recipe: inner line box of 1 em, ink measured with `host.metrics`). Sets font, box (ink + padding), textAt,
 * inkBox, baseline and an inner origin at the ink centre.
 */
export function setText(u: Unit, m: Metrics, S: number, weight: number, x: number, y: number): void {
  const w = inkW(m) * S;
  const base = y + m.ia * S;
  const box = { x: x - PAD_X * S, y: y - PAD_Y * S, w: w + 2 * PAD_X * S, h: (inkH(m) + 2 * PAD_Y) * S };
  const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
  const inkBox = { x: -m.bl * S, y: -m.ia * S + mid, w, h: inkH(m) * S };
  Object.assign(u, {
    box,
    baseline: base,
    font: { family: 'display', size: S, weight },
    textAt: { x: x + m.bl * S - box.x, y: base - mid - box.y },
    inkBox,
    innerOrigin: `${(inkBox.x + w / 2).toFixed(2)}px ${(inkBox.y + inkBox.h / 2).toFixed(2)}px`,
  });
}

/** Relative luminance of `#RRGGBB`. */
function lum(hex: string): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast of two `#RRGGBB` colours. */
export function contrastOf(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The candidate with the best contrast on `fill` (first wins ties). */
export function inkOn(fill: string, ...candidates: string[]): string {
  let best = candidates[0]!;
  for (const c of candidates) if (contrastOf(c, fill) > contrastOf(best, fill) + 1e-9) best = c;
  return best;
}

/** `#RRGGBB` + alpha → rgba(). */
export function rgbaOf(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** Linear mix of two rgba colours given as [r, g, b, a]. */
export function mixRgba(a: readonly number[], b: readonly number[], k: number): string {
  const v = a.map((x, i) => x + (b[i]! - x) * k);
  return `rgba(${Math.round(v[0]!)},${Math.round(v[1]!)},${Math.round(v[2]!)},${v[3]!.toFixed(3)})`;
}

/** `#RRGGBB` (or null = transparent, taking `like`'s rgb) → [r, g, b, a]. */
export function rgbaArr(hex: string | null, like = '#000000'): [number, number, number, number] {
  const [r, g, b] = rgbOf(hex ?? like);
  return [r, g, b, hex ? 1 : 0];
}

export const lerpBox = (a: Box, b: Box, k: number): Box => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  w: a.w + (b.w - a.w) * k,
  h: a.h + (b.h - a.h) * k,
});

/**
 * The window in which a section's content leaves: the first part of the next section's incoming window, when that
 * section starts another layer. [t0, t1] with t1 − t0 ≤ `max` s (and ≤ 45 % of the window).
 */
export function exitSpan(s: Section, max = 0.24): { t0: number; t1: number } | null {
  const n = s.next;
  if (!n || n.layer === s.layer || !n.window || n.window.t1 <= n.window.t0) return null;
  const w = n.window;
  return { t0: w.t0, t1: w.t0 + Math.min(max, 0.45 * (w.t1 - w.t0)) };
}

/** Writes a trait-owned absolutely positioned box (every property, every frame). */
export function putBox(e: HTMLElement, b: Box | null, style: Record<string, string> = {}): void {
  const s = e.style;
  if (!b || b.w <= 0.01 || b.h <= 0.01) {
    s.display = 'none';
    return;
  }
  s.display = 'block';
  s.left = `${b.x.toFixed(2)}px`;
  s.top = `${b.y.toFixed(2)}px`;
  s.width = `${b.w.toFixed(2)}px`;
  s.height = `${b.h.toFixed(2)}px`;
  for (const [k, v] of Object.entries(style)) s.setProperty(k, v);
}

/** The fixed modular grid of a format: `cols × rows` modules with gutters, filling the safe area / `hi`. */
export interface Grid {
  cols: number;
  rows: number;
  /** Top-left of the first module. */
  x0: number;
  y0: number;
  /** Module width / height and the gutter. */
  cw: number;
  rh: number;
  g: number;
}

/**
 * Portrait and square formats get `n` columns, wide ones `n` rows; modules stay close to square. `gutter` is a
 * fraction of the shorter safe side.
 */
export function moduleGrid(host: Host, hi = 1, n = 4, gutter = 0.022): Grid {
  const { safe } = host;
  const w = safe.w / hi;
  const h = safe.h / hi;
  const g = Math.round(gutter * Math.min(w, h));
  let cols = n;
  let rows = n;
  if (w >= 1.3 * h) cols = 2 * Math.round((rows * w) / h / 2);
  else rows = Math.max(n - 1, Math.round((cols * h) / w));
  return { cols, rows, x0: safe.cx - w / 2, y0: safe.cy - h / 2, cw: (w - (cols - 1) * g) / cols, rh: (h - (rows - 1) * g) / rows, g };
}

/** Group-coordinate rect of the span of `cs × rs` modules from column c, row r. */
export const spanBox = (G: Grid, c: number, r: number, cs: number, rs: number): Box => ({
  x: G.x0 + c * (G.cw + G.g),
  y: G.y0 + r * (G.rh + G.g),
  w: cs * G.cw + (cs - 1) * G.g,
  h: rs * G.rh + (rs - 1) * G.g,
});

/** Word gap inside a line and extra gap between lines, em. */
export const WORD_GAP = 0.26;
export const LINE_GAP = 0.2;

/** A run broken into lines: font size, end index of each line, and the block's size and line extents per px. */
export interface LineFit {
  S: number;
  breaks: number[];
  bw: number;
  bh: number;
  ia: number;
  id: number;
}

/**
 * Breaks a run of words (their metrics, logical order) into ≤ `maxLines` lines of consecutive words for a `w × h`
 * px box: the largest font size wins (first candidate on ties).
 */
export function fitLines(ms: readonly Metrics[], w: number, h: number, maxLines = 4): LineFit {
  const n = ms.length;
  const ia = Math.max(...ms.map((m) => m.ia));
  const id = Math.max(...ms.map((m) => m.id));
  let best: LineFit = { S: 0, breaks: [n], bw: 1, bh: 1, ia, id };
  const rec = (from: number, left: number, acc: number[]): void => {
    if (left === 1) {
      const breaks = [...acc, n];
      let bw = 0;
      let a = 0;
      for (const b of breaks) {
        let lw = WORD_GAP * (b - a - 1);
        for (let i = a; i < b; i++) lw += inkW(ms[i]!);
        bw = Math.max(bw, lw);
        a = b;
      }
      const L = breaks.length;
      const bh = L * (ia + id) + (L - 1) * LINE_GAP;
      const S = Math.min(w / bw, h / bh);
      if (S > best.S + 1e-9) best = { S, breaks, bw, bh, ia, id };
      return;
    }
    for (let b = from + 1; b <= n - left + 1; b++) rec(b, left - 1, [...acc, b]);
  };
  for (let L = 1; L <= Math.min(n, maxLines); L++) rec(0, L, []);
  return best;
}

/**
 * Typesets a run inside `box` as `f` broke it: each line in bidi visual order, aligned to the box's start / centre /
 * end (text direction) and the block to its top / middle / bottom. Sets `tags.line`.
 */
export function placeLines(
  units: readonly Unit[],
  ms: readonly Metrics[],
  weights: readonly number[],
  f: LineFit,
  box: Box,
  align: 'start' | 'center' | 'end',
  valign: 'top' | 'middle' | 'bottom',
  dir: 'rtl' | 'ltr',
): void {
  const { S } = f;
  const blockH = f.bh * S;
  let y = valign === 'top' ? box.y : valign === 'bottom' ? box.y + box.h - blockH : box.y + (box.h - blockH) / 2;
  const toRight = (align === 'start') === (dir === 'rtl');
  let a = 0;
  f.breaks.forEach((b, li) => {
    const idx = Array.from({ length: b - a }, (_, j) => a + j);
    const lw = (idx.reduce((q, i) => q + inkW(ms[i]!), 0) + WORD_GAP * (idx.length - 1)) * S;
    let x = align === 'center' ? box.x + (box.w - lw) / 2 : toRight ? box.x + box.w - lw : box.x;
    const base = y + f.ia * S;
    for (const o of visualOrder(idx.map((i) => units[i]!.text), dir)) {
      const i = idx[o]!;
      const m = ms[i]!;
      setText(units[i]!, m, S, weights[i]!, x, base - m.ia * S);
      units[i]!.tags.line = li;
      x += (inkW(m) + WORD_GAP) * S;
    }
    y += (f.ia + f.id + LINE_GAP) * S;
    a = b;
  });
}

/** A unit's place at one re-flow step: the ink's top-left corner at font size S (and its cell, if any). */
export interface Placed {
  box: Box;
  S: number;
  x: number;
  y: number;
}

/**
 * FLIP: unit i's place at time t, given its place at every step (steps[k][i] once units 0…k have landed) and each
 * step's eased progress ks[k]: its first step plus every later step's eased difference (overlapping moves add).
 */
export function flipAt(steps: readonly Placed[][], i: number, ks: readonly number[]): Placed {
  const p0 = steps[i]![i]!;
  const p = { box: { ...p0.box }, S: p0.S, x: p0.x, y: p0.y };
  for (let j = i + 1; j < steps.length; j++) {
    const k = ks[j]!;
    if (k <= 0) continue;
    const a = steps[j - 1]![i]!;
    const b = steps[j]![i]!;
    p.box.x += (b.box.x - a.box.x) * k;
    p.box.y += (b.box.y - a.box.y) * k;
    p.box.w += (b.box.w - a.box.w) * k;
    p.box.h += (b.box.h - a.box.h) * k;
    p.S += (b.S - a.S) * k;
    p.x += (b.x - a.x) * k;
    p.y += (b.y - a.y) * k;
  }
  return p;
}

/**
 * Moves a unit typeset at its final place `f` (origin `0 0`, see `setText`) to place `p`: translate + uniform scale
 * so its ink's top-left lands on (p.x, p.y) at size p.S.
 */
export function applyPlace(u: Unit, p: Placed, f: Placed): void {
  const sc = p.S / f.S;
  u.ch.tx += p.x - u.box.x - sc * (f.x - u.box.x);
  u.ch.ty += p.y - u.box.y - sc * (f.y - u.box.y);
  u.ch.sx *= sc;
  u.ch.sy *= sc;
}

/**
 * One soft swipe per re-flow move of a FLIP layout (every landing after a section's first), from `lead` before
 * the landing over `dur`, pitch rising through the section.
 */
export function reflowSwipes(layer: Layer, lead: number, dur: number): SoundCue[] {
  return layer.sections.flatMap((s) =>
    s.units
      .filter((u, i) => i > 0 && u.item >= 0 && Number.isFinite(u.at))
      .map((u, j): SoundCue => ({ t: u.at - lead, until: u.at - lead + dur, kind: 'swipe', weight: 0.22, pitch: Math.min(6, j), section: s.id })),
  );
}
