/**
 * Word attachment (SKETCH-PLAN.md P5, SK10): pure geometry for a sketch placed on a word, in the coordinates of the
 * word's inner text element (untransformed px). The page mirrors the unit's own transforms around it, so the camera,
 * the section's placement and the unit's motion all apply to the drawing exactly as they apply to the word.
 *
 * - `wordRange`: which characters `part` names (the k-th whitespace-separated word, as `@reel/core` validates it).
 * - `partBox` / `unionBox`: per-letter styles anchor on the union of the word's letter parts, each moved by its own
 *   part channels (path styles carry letters along a curve until the hold).
 * - `fitWord`: where the drawing goes around the anchor box: `around` (an enclosing ellipse with `pad`), `under` (the
 *   word's width, below the baseline), `beside` (on the logical start side, pointing at the word; mirrored for RTL).
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** UTF-16 `[start, end)` of the k-th whitespace-separated word of `text`; null when there is none. */
export function wordRange(text: string, k: number): [number, number] | null {
  let i = 0;
  for (const m of text.matchAll(/\S+/gu)) {
    if (i++ === k) return [m.index, m.index + m[0].length];
  }
  return null;
}

/** The channels of a part span that move its box (`commit.ts`: translate → rotate → skewX → scale). */
export interface PartMove {
  tx: number;
  ty: number;
  rot: number;
  skx: number;
  sx: number;
  sy: number;
}

/**
 * Axis-aligned box of a part's measured rect after its own transform, about the rect's centre (the convention of
 * `lib/pathtext.ts`). `band` replaces the rect's vertical extent (the font box) by the ink band of the word.
 */
export function partBox(r: Box, band: readonly [number, number] | null, m: PartMove): Box {
  const ox = r.x + r.w / 2;
  const oy = r.y + r.h / 2;
  const [y0, y1] = band ?? [r.y, r.y + r.h];
  const a = (m.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const k = Math.tan((m.skx * Math.PI) / 180);
  let x0 = Infinity;
  let x1 = -Infinity;
  let yy0 = Infinity;
  let yy1 = -Infinity;
  for (const [px, py] of [
    [r.x, y0],
    [r.x + r.w, y0],
    [r.x, y1],
    [r.x + r.w, y1],
  ] as const) {
    const sx = (px - ox) * m.sx;
    const sy = (py - oy) * m.sy;
    const kx = sx + k * sy;
    const x = ox + m.tx + kx * cos - sy * sin;
    const y = oy + m.ty + kx * sin + sy * cos;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    yy0 = Math.min(yy0, y);
    yy1 = Math.max(yy1, y);
  }
  return { x: x0, y: yy0, w: x1 - x0, h: yy1 - yy0 };
}

/** Smallest box holding every box; null for none. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type WordFit = 'around' | 'under' | 'beside';

/**
 * How much of its box the drawing's own shape uses, per fit: the circle preset's ellipse spans 94 % × 90.6 % of its
 * box; the underline's ink runs from 3 % to 97 % of the width and starts 33 % down; the arrow's tip sits at 92 % of the
 * width, half-way down. Generated drawings use the same proportions (their box is their extent).
 */
const AROUND = { w: 0.94, h: 0.906 } as const;
const UNDER = { x0: 0.03, x1: 0.97, top: 0.33 } as const;
const TIP = { x: 0.92, y: 0.5 } as const;

export interface Fitted {
  /** Where the drawing's box goes (inner coordinates). */
  rect: Box;
  /** Mirror the drawing horizontally (an arrow on the right of a word points left, at it). */
  flip: boolean;
  /** Turn the drawing a quarter clockwise (an arrow above the word points down at it); `rect` is the turned box. */
  turn: boolean;
}

/**
 * How a fit gives way when the drawing would leave the safe area (a word that already spans the safe width):
 * `spread` (around) = share of the ellipse's overhang beside the word; `hug` (around) = the ellipse hugs the word's
 * height and crosses its ends (its half-width is the word's + pad); `side` (beside) = the word's reading start, its
 * end, or above its start pointing down; `size` (beside) = scale of the drawing; `trim` (any fit, set by the page's
 * final clamp) = shares of the fitted box cut from its left, right, top and bottom (`trimOf`).
 */
export interface FitVariant {
  spread?: number;
  hug?: boolean;
  side?: 'start' | 'end' | 'above';
  size?: number;
  trim?: readonly [number, number, number, number];
}

/** The variants the page tries in order, keeping the first whose drawing stays inside the safe area at the hold. */
export const FIT_VARIANTS: Record<WordFit, readonly FitVariant[]> = {
  around: [{ spread: 1 }, { spread: 0.5 }, { spread: 0 }, { spread: 0, hug: true }],
  under: [{}],
  beside: [{ side: 'start' }, { side: 'end' }, { side: 'above' }, { side: 'start', size: 0.6 }, { side: 'end', size: 0.6 }, { side: 'above', size: 0.6 }],
};

/**
 * A fitted box shrunk to the limits `minX..maxX`, `minY..maxY` (same coordinates), side by side: a side only moves
 * inward, never past the centre line of `word` (the drawing always holds the word's centre), so the result lies inside
 * the limits whenever they hold that centre.
 */
export function clampFit(rect: Box, word: Box, minX: number, maxX: number, minY: number, maxY: number): Box {
  const cx = word.x + word.w / 2;
  const cy = word.y + word.h / 2;
  const x0 = Math.max(rect.x, Math.min(minX, cx));
  const x1 = Math.min(rect.x + rect.w, Math.max(maxX, cx));
  const y0 = Math.max(rect.y, Math.min(minY, cy));
  const y1 = Math.min(rect.y + rect.h, Math.max(maxY, cy));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** The `trim` that turns the fitted box `from` into `to` (a box inside it): shares cut from left, right, top, bottom. */
export function trimOf(from: Box, to: Box): [number, number, number, number] {
  const w = Math.max(1e-9, from.w);
  const h = Math.max(1e-9, from.h);
  return [(to.x - from.x) / w, (from.x + from.w - to.x - to.w) / w, (to.y - from.y) / h, (from.y + from.h - to.y - to.h) / h];
}

/** A fitted box cut by a variant's `trim` (none: the box itself). */
function trimmed(r: Box, trim: FitVariant['trim']): Box {
  if (!trim) return r;
  const [l, rt, t, b] = trim;
  return { x: r.x + l * r.w, y: r.y + t * r.h, w: r.w * (1 - l - rt), h: r.h * (1 - t - b) };
}

/**
 * The drawing's box for a word box `a` (ink extent) whose baseline is at `baseline`; `pad` in the same px (default:
 * a share of the word height). `rtl`: the reading direction of the word's line (its logical start is on the right).
 * `box` is the drawing's own box (its aspect sizes `under` and `beside`). The variant's `trim` cuts the result.
 */
export function fitWord(a: Box, baseline: number, fit: WordFit, pad: number | undefined, rtl: boolean, box: readonly [number, number], v: FitVariant = {}): Fitted {
  const f = fitUntrimmed(a, baseline, fit, pad, rtl, box, v);
  return v.trim ? { ...f, rect: trimmed(f.rect, v.trim) } : f;
}

function fitUntrimmed(a: Box, baseline: number, fit: WordFit, pad: number | undefined, rtl: boolean, box: readonly [number, number], v: FitVariant): Fitted {
  const h = Math.max(1, a.h);
  const w = Math.max(1, a.w);
  const cx = a.x + w / 2;
  const cy = a.y + h / 2;
  if (fit === 'around') {
    const m = pad ?? 0.08 * h;
    // hug: half the word's width + pad across (the ends cross the ellipse), its height + at least 0.15 h each way
    // else the smallest ellipse through the corners (a = w/√2), its overhang beside the word capped at 0.75 h
    // (× spread), then b from the corner condition (w/2a)² + (h/2b)² = 1, at most 0.95 h (long words: the ends cut
    // the corners)
    let ex: number;
    let ey: number;
    if (v.hug) {
      ex = w / 2 + m;
      ey = h / 2 + Math.max(m, 0.15 * h);
    } else {
      const ax = w / 2 + (v.spread ?? 1) * Math.min(w / Math.SQRT2 - w / 2, 0.75 * h);
      const q = w / (2 * ax);
      const by = q < 1 ? Math.min(h / 2 / Math.sqrt(1 - q * q), 0.95 * h) : 0.95 * h;
      ex = ax + m;
      ey = by + m;
    }
    const rw = (2 * ex) / AROUND.w;
    const rh = (2 * ey) / AROUND.h;
    return { rect: { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh }, flip: false, turn: false };
  }
  if (fit === 'under') {
    const rw = w / (UNDER.x1 - UNDER.x0);
    const rh = Math.min((rw * box[1]) / box[0], 0.45 * h);
    const gap = 0.06 * h + (pad ?? 0);
    return { rect: { x: a.x - UNDER.x0 * rw, y: baseline + gap - UNDER.top * rh, w: rw, h: rh }, flip: false, turn: false };
  }
  const rh = 0.8 * h * (v.size ?? 1);
  const rw = Math.min((rh * box[0]) / box[1], 2.4 * h * (v.size ?? 1));
  const gap = 0.12 * h + (pad ?? 0);
  if (v.side === 'above') {
    // turned: the drawing runs down (its length is the box height) with its tip on the word's top, at its start end
    const tipX = rtl ? a.x + w - 0.25 * Math.min(w, 2 * h) : a.x + 0.25 * Math.min(w, 2 * h);
    return { rect: { x: tipX - TIP.y * rh, y: a.y - gap - TIP.x * rw, w: rh, h: rw }, flip: false, turn: true };
  }
  const y = cy - TIP.y * rh;
  // the start side is on the right of a right-to-left line; on the right the drawing is mirrored to point left
  const right = (v.side ?? 'start') === 'start' ? rtl : !rtl;
  return right
    ? { rect: { x: a.x + w + gap - (1 - TIP.x) * rw, y, w: rw, h: rh }, flip: true, turn: false }
    : { rect: { x: a.x - gap - TIP.x * rw, y, w: rw, h: rh }, flip: false, turn: false };
}

/**
 * What the final clamp (`clampFit`) must keep of a fitted drawing: the word for `around` and `under` (its centre lines),
 * the arrow's tip for `beside` (the drawing sits off the word).
 */
export function keepOf(f: Fitted, fit: WordFit, word: Box): Box {
  if (fit !== 'beside') return word;
  const r = f.rect;
  const tip = f.turn ? { x: r.x + TIP.y * r.w, y: r.y + TIP.x * r.h } : { x: r.x + (f.flip ? 1 - TIP.x : TIP.x) * r.w, y: r.y + TIP.y * r.h };
  return { ...tip, w: 0, h: 0 };
}
