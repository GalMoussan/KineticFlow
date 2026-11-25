/**
 * Shared pieces of the scrolling/spatial styles (stacked-scroll, credits-roll, ticker-bands, infinite-zoom,
 * paper-fold): one role-aware centred block per section (center-stack's rules from `lib/rowset.ts`, fitted into any
 * box), a cubic Hermite for C1 camera paths, and HTML escaping for marquee runs. Page-side only.
 */
import type { Host, Section } from '../contract.ts';
import { chooseRowsSub, lightDark, placeRows, roleBlocks, stackSize, type Row, type RowGeom, type StackOpts } from './rowset.ts';

export type Fit = StackOpts['fit'];

export interface BlockOpts {
  /** Largest f = 1 font size (px). */
  cap: number;
  /** Plain word size (× emphasis size). */
  plain: number;
  /** Gap between rows (em of the rows). */
  leading: number;
  /** Weight of the big words (clamped to the font). */
  wt?: number;
  /** Location pin before the place. */
  pin?: boolean;
  /** Largest hold zoom the block must survive (default: the section's `zoomRange`). */
  hi?: number;
}

/** Stack options for `fit` (centred rows). */
export function stackOpts(host: Host, s: Section, fit: Fit, o: BlockOpts): StackOpts {
  return { gap: 0.26, leading: o.leading, headroom: 0, fit, cap: o.cap, hi: o.hi ?? host.zoomRange(s)[1] * 1.005, align: 'center' };
}

/**
 * The section's rows (role blocks, k words per packed row as center-stack chooses them; a sub line wrapped under them)
 * and their base size in `fit`.
 */
export function blockRows(host: Host, s: Section, fit: Fit, o: BlockOpts): { rows: Row[]; size: number; so: StackOpts } {
  const so = stackOpts(host, s, fit, o);
  const blocks = roleBlocks(host, s, { plain: o.plain, wt: o.wt ?? 900, pin: o.pin ?? true });
  const wide = fit.x1 - fit.x0 > 1.3 * (fit.y1 - fit.y0);
  return { ...chooseRowsSub(host, blocks, so, wide), so };
}

/** Places `rows` centred in `so.fit` (badge colours from the palette); sets units, place, frame and bounds. */
export function placeBlock(host: Host, s: Section, rows: Row[], size: number, so: StackOpts): RowGeom[] {
  const { light, dark } = lightDark(s);
  return placeRows(host, s, rows, size, so, { fill: light, border: dark, shadow: null });
}

/** Role-aware centred block of the section's content fitted into `fit`. */
export function centredBlock(host: Host, s: Section, fit: Fit, o: BlockOpts): { rows: RowGeom[]; size: number } {
  const { rows, size, so } = blockRows(host, s, fit, o);
  return { rows: placeBlock(host, s, rows, size, so), size };
}

/** Base size at which `rows` fit `fit` (no zoom headroom beyond `hi`). */
export const sizeIn = (host: Host, rows: Row[], so: StackOpts, fit: Fit): number => stackSize(host, rows, { ...so, fit });

/** Vertical extent of placed rows (ink top of the first to ink bottom of the last) and their horizontal extent. */
export function extent(rows: readonly RowGeom[]): { x0: number; x1: number; y0: number; y1: number } {
  return {
    x0: Math.min(...rows.map((r) => r.x0)),
    x1: Math.max(...rows.map((r) => r.x1)),
    y0: Math.min(...rows.map((r) => r.top)),
    y1: Math.max(...rows.map((r) => r.bottom)),
  };
}

/** Cubic Hermite from p0 to p1 at k ∈ [0, 1] with end slopes m0, m1 (per unit of k): C1 joins of camera pieces. */
export function hermite(p0: number, p1: number, m0: number, m1: number, k: number): number {
  const k2 = k * k;
  const k3 = k2 * k;
  return (2 * k3 - 3 * k2 + 1) * p0 + (k3 - 2 * k2 + k) * m0 + (-2 * k3 + 3 * k2) * p1 + (k3 - k2) * m1;
}

/** Text for `innerHTML`. */
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Clamp to 0..1 without pulling in runtime (this file stays importable from Node tests). */
export const unit01 = (k: number): number => (k < 0 ? 0 : k > 1 ? 1 : k);

/** Progress of t across [a, b]; 0 before a, 1 after b. A zero-length span snaps. */
export const span01 = (t: number, a: number, b: number): number => (b > a ? unit01((t - a) / (b - a)) : t >= b ? 1 : 0);

/** Smoothstep on 0..1. */
export const smoothstep = (k: number): number => {
  const x = unit01(k);
  return x * x * (3 - 2 * x);
};

/** Ease-out cubic: fast, then a stop. */
export const easeOut3 = (k: number): number => {
  const u = 1 - unit01(k);
  return 1 - u * u * u;
};

/**
 * Column the ramp-scroll camera travels. Stored on `section.data.layout` by `layout/scroll-stack`.
 * `reach` is the in/out travel in layer px.
 */
export interface Stack {
  period: number;
  h: number;
  jmin: number;
  n: number;
  reach: number;
  steps: number[];
  stepDur: number;
}

/**
 * Fold a panel of `full` px. k = 0 is a `crease`-px hinge, k = 1 is the full panel.
 * Size and the inset from the full box's start are whole px (the fold resizes the box; it never scales type).
 */
export function foldBox(full: number, k: number, crease = 4): { size: number; inset: number } {
  const F = Math.max(1, Math.round(full));
  const c = Math.max(1, Math.min(F, Math.round(crease)));
  const size = c + Math.round((F - c) * unit01(k));
  return { size, inset: Math.round((F - size) / 2) };
}

/** When a panel opens and, if there is a next layer, when it shuts. Flat strictly before `holdStart`. */
export function foldWindows(
  inn: number,
  holdStart: number,
  out: number,
  win: { t0: number; t1: number } | null,
  nextWin: { t0: number; t1: number } | null,
): { open0: number; open1: number; shut0: number; shut1: number } {
  const open0 = win ? win.t0 + 0.42 * (win.t1 - win.t0) : Math.min(holdStart - 0.5, Math.max(0.05, inn - 0.55));
  let open1 = Math.min(holdStart - 0.06, open0 + 0.72);
  if (open1 < open0 + 0.22) open1 = open0 + 0.22;
  if (open1 > holdStart - 0.04) open1 = holdStart - 0.04;
  const open0c = open0 > open1 - 0.18 ? open1 - 0.18 : open0;
  const shut0 = nextWin ? out : Number.POSITIVE_INFINITY;
  const shut1 = nextWin ? (nextWin.t0 + nextWin.t1) / 2 : Number.POSITIVE_INFINITY;
  return { open0: open0c, open1, shut0, shut1 };
}

/** 0 folded, 1 flat. Closing multiplies the open amount back down. */
export function foldK(t: number, w: { open0: number; open1: number; shut0: number; shut1: number }): number {
  const open = smoothstep(span01(t, w.open0, w.open1));
  if (!(t >= w.shut0) || !(w.shut1 > w.shut0)) return open;
  return open * (1 - smoothstep(span01(t, w.shut0, w.shut1)));
}

/**
 * `itx` that puts repeat `copy` of a phrase (width `phrase`, pitch `stride`) in the middle of a `view`-px window.
 * The run's local x = 0 is the start of repeat 0; the result is whole px.
 */
export function centerPhrase(phrase: number, stride: number, view: number, copy: number): number {
  return Math.round(view / 2 - (copy * stride + phrase / 2));
}

/**
 * Marquee lock for ticker-bands. The run scrolls from `scroll0` and is stopped by `scroll1`
 * (strictly before the hold). The centre plate and the readable copy fade in over the same end.
 */
export function bandTimes(
  inn: number,
  holdStart: number,
  win: { t0: number; t1: number } | null,
): { scroll0: number; scroll1: number; fade0: number; fade1: number } {
  const scroll1 = holdStart - 0.02;
  let scroll0 = win ? win.t0 : Math.max(0, inn - 0.2);
  if (scroll0 > scroll1 - 0.24) scroll0 = scroll1 - 0.24;
  const fade1 = scroll1;
  const fade0 = Math.max(scroll0, fade1 - 0.32);
  return { scroll0, scroll1, fade0, fade1 };
}

/**
 * The hold start ticker-bands locks on. With a sub line the lock lands just before the first sub word, so the sub
 * words land one by one on the locked plate; without one it is the section's hold start.
 */
export function bandHold(s: Section): number {
  let first = Number.POSITIVE_INFINITY;
  for (const u of s.units) if (u.item >= 0 && u.kind === 'sub' && u.at < first) first = u.at;
  return first < s.timing.holdStart ? Math.max(s.timing.in, first - 0.06) : s.timing.holdStart;
}
