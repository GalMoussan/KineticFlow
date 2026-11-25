/**
 * Letter-tile mosaic (tile-mosaic): the grid a `layout: tile-board` lays a layer out on, and the state of every
 * mosaic cell at t, shared by the background that draws the idle cells (`background: tile-ripple`) and the reveal
 * that draws the letter tiles (`reveal: tile-flip`), so a letter tile's back face is exactly an idle cell until it
 * flips to its letter. Page-side (uses `Math.*` and `hash`).
 *
 * A cell appears when the layer's intro wave reaches it (a tile unfolding from edge-on), then flips to its next
 * colour each time a ripple wave passes (ripples start on every `every`-th beat of the cue sheet, from a corner, an
 * edge or the centre). Its colour index is the number of ripples that have passed, a pure function of t. Flips are
 * planar turns about the vertical axis drawn by resizing the tile's width in whole px (|cos|), shaded towards the
 * grout near edge-on.
 */
import { hash } from '@reel/runtime';
import type { Host, Layer } from '../contract.ts';

/** `layer.data.layout` of a tile-board layer (fingerprinted): the grid and what sits on it. */
export interface MosaicGrid {
  /** Cell pitch, grout, tile corner radius (whole px). */
  p: number;
  g: number;
  r: number;
  /** Top-left of cell (0, 0) in layer px. */
  ox: number;
  oy: number;
  /** Cell index range (inclusive) covering the frame. */
  c0: number;
  c1: number;
  r0: number;
  r1: number;
  /** Cells drawn by content units (letter tiles, the logo tile), flat `[col, row, …]`; the background skips them. */
  occ: number[];
  /** Intro wave: origin (layer px), start and duration (s). */
  intro: { x: number; y: number; t0: number; dur: number };
  seed: number;
}

/** `unit.data.layout` of a content unit (fingerprinted). */
export interface TileRun {
  /** First cell (left) and row of the run; `rows` > 1 only for the logo tile. */
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** Visual cells left to right: '1' letter, '0' word space (an idle cell). Empty for the logo tile. */
  mask: string;
  /** Glyph colour (read by `material: tile-ink`). */
  ink: string;
  /** Sub words: `col`, `row`, `cols` count small tiles (`mini` per board cell side), and the letter face colour. */
  mini?: number;
  face?: string;
}

/**
 * `section.data.layout.strip` of a tile-board section with a sub line: board rows `row … row + rows − 1`, columns
 * `0 … cols − 1`, cut into `k × k` small tiles (grout `g`, corner radius `r`, whole px). The reveal draws them.
 */
export interface TileStrip {
  row: number;
  rows: number;
  cols: number;
  k: number;
  g: number;
  r: number;
}

/** Background timing params shared with the reveal (the reveal reads the background's defaults if it has none). */
export interface RippleParams {
  /** Every n-th beat starts a ripple. */
  every: number;
  /** Seconds a ripple takes to cross the frame. */
  sweep: number;
  /** Seconds one cell flip takes. */
  flip: number;
}

export const RIPPLE_DEFAULTS: RippleParams = { every: 2, sweep: 1.1, flip: 0.32 };

/** Background ripple timing from a resolved style's `<axis>.<param>` bag, else the tile-ripple defaults. */
export function rippleParams(bag: Record<string, number> | undefined, fallback: RippleParams = RIPPLE_DEFAULTS): RippleParams {
  const n = (k: string, d: number) => {
    const v = bag?.[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
  };
  return { every: n('background.every', fallback.every), sweep: n('background.sweep', fallback.sweep), flip: n('background.flip', fallback.flip) };
}

interface Wave {
  t: number;
  x: number;
  y: number;
  /** Seconds per px of distance from the origin. */
  k: number;
}

export interface Mosaic {
  grid: MosaicGrid;
  bg: string;
  tones: string[];
  ripples: Wave[];
  /** Intro: seconds per px. */
  ik: number;
  introEnd: number;
  flip: number;
  sweep: number;
  /** Rounded `every` this mosaic was built with. A later caller with different timing rebuilds it. */
  every: number;
}

/** One cell at t: `w` = width factor 0..1 (0 = not drawn), `fill` = CSS colour, already shaded. */
export interface CellLook {
  w: number;
  fill: string;
}

const NONE: CellLook = { w: 0, fill: 'transparent' };
/** Seconds the new face glints after a ripple swap. */
const GLINT = 0.35;

/** `pct` % of `a` over `b`. */
export const mix = (a: string, pct: number, b: string): string =>
  pct >= 100 ? a : pct <= 0 ? b : `color-mix(in srgb, ${a} ${pct.toFixed(1)}%, ${b})`;

/** Muted idle tones: each accent pre-mixed towards the grout at two strengths, plus two near-grout neutrals. */
export function idleTones(bg: string, text: string, accents: readonly string[]): string[] {
  const a = accents.slice(0, 5);
  return [...a.map((c) => mix(c, 46, bg)), ...a.map((c) => mix(c, 30, bg)), mix(text, 16, bg), mix(text, 10, bg)];
}

const cache = new WeakMap<Layer, Mosaic>();

/** The layer's mosaic (grid from `layer.data.layout`, ripple waves from the beat grid), built once per layer. */
export function mosaicOf(host: Host, layer: Layer, rp: RippleParams = RIPPLE_DEFAULTS): Mosaic | null {
  const every = Math.max(1, Math.round(rp.every));
  const hit = cache.get(layer);
  if (hit && hit.every === every && hit.sweep === rp.sweep && hit.flip === rp.flip) return hit;
  const grid = layer.data.layout as MosaicGrid | undefined;
  if (!grid || !grid.p) return null;
  const { W, H } = host;
  const far = (x: number, y: number) => Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
  const anchors = [
    [0, 0], [W, 0], [0, H], [W, H], [W / 2, 0], [W / 2, H], [0, H / 2], [W, H / 2], [W / 2, H / 2],
  ] as const;
  const I = grid.intro;
  const introEnd = I.t0 + I.dur + rp.flip;
  const beats = host.reel.cues.beats;
  const ripples: Wave[] = [];
  beats.forEach((b, i) => {
    if (i % every || b < introEnd || b >= layer.end) return;
    const [x, y] = anchors[Math.floor(hash(i * 3.17 + grid.seed) * anchors.length)]!;
    ripples.push({ t: b, x, y, k: rp.sweep / far(x, y) });
  });
  const pal = layer.palette;
  const m: Mosaic = {
    grid,
    bg: pal.bg,
    tones: idleTones(pal.bg, pal.text, pal.accents),
    ripples,
    ik: I.dur / far(I.x, I.y),
    introEnd,
    flip: rp.flip,
    sweep: rp.sweep,
    every,
  };
  cache.set(layer, m);
  return m;
}

/** Centre of a cell in layer px. */
export const cellCentre = (g: MosaicGrid, col: number, row: number): [number, number] => [g.ox + (col + 0.5) * g.p, g.oy + (row + 0.5) * g.p];

/** When the intro wave reaches a cell (it then unfolds over `flip`). */
export function introAt(m: Mosaic, col: number, row: number): number {
  const [x, y] = cellCentre(m.grid, col, row);
  return m.grid.intro.t0 + m.ik * Math.hypot(x - m.grid.intro.x, y - m.grid.intro.y);
}

/** Shades a face towards the grout as it turns edge-on (`w` = |cos| of the turn). */
export const shade = (m: Mosaic, fill: string, w: number): string => mix(fill, 100 - 62 * (1 - w), m.bg);

/** Number of ripples that have passed the first `i` (sorted) whose fronts are certainly past every cell. */
function settled(m: Mosaic, t: number): number {
  const lim = t - m.sweep - m.flip;
  let lo = 0;
  let hi = m.ripples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m.ripples[mid]!.t <= lim) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The idle look of a cell at t: nothing before the intro wave reaches it, then a tile unfolding into its tone, then
 * one flip to the next tone per passing ripple (with a short glint). Pure function of t.
 */
export function idleCell(m: Mosaic, col: number, row: number, t: number): CellLook {
  const g = m.grid;
  const ti = introAt(m, col, row);
  if (t < ti) return NONE;
  const base = Math.floor(hash(col * 1.618 + row * 7.919 + g.seed) * m.tones.length);
  const tone = (n: number) => m.tones[(base + n) % m.tones.length]!;
  if (t < ti + m.flip) {
    const w = Math.sin(((t - ti) / m.flip) * (Math.PI / 2));
    return { w, fill: shade(m, tone(0), w) };
  }
  const [x, y] = cellCentre(g, col, row);
  let n = settled(m, t);
  let turning = -1;
  let since = Infinity;
  for (let j = n; j < m.ripples.length; j++) {
    const r = m.ripples[j]!;
    if (r.t > t) break;
    const tj = r.t + r.k * Math.hypot(x - r.x, y - r.y);
    if (t < tj) continue;
    const ph = (t - tj) / m.flip;
    if (ph < 1) turning = ph;
    if (ph >= 0.5) {
      n++;
      since = Math.min(since, t - tj - m.flip / 2);
    }
  }
  if (turning >= 0) {
    const w = Math.abs(Math.cos(Math.PI * turning));
    return { w, fill: shade(m, tone(n), w) };
  }
  if (since < GLINT) return { w: 1, fill: mix(m.tones[(base + n) % m.tones.length]!, 100 - 45 * (1 - since / GLINT), '#FFFFFF') };
  return { w: 1, fill: tone(n) };
}

/** Writes a style property only when it changed (trait-owned elements; every property is still set every frame). */
const written = new WeakMap<HTMLElement, Map<string, string>>();
export function put(el: HTMLElement, prop: string, value: string): void {
  let m = written.get(el);
  if (!m) written.set(el, (m = new Map()));
  if (m.get(prop) === value) return;
  m.set(prop, value);
  el.style.setProperty(prop, value);
}

/** Draws a tile element at `x, y` (its cell rect's top-left inside the parent, px) turned to width factor `w`. */
export function drawTile(el: HTMLElement, g: MosaicGrid, x: number, y: number, wCells: number, hCells: number, look: CellLook): void {
  const fw = wCells * g.p - g.g;
  const w = Math.round(fw * look.w);
  put(el, 'display', w >= 1 ? 'block' : 'none');
  put(el, 'left', `${x + g.g / 2 + Math.round((fw - w) / 2)}px`);
  put(el, 'top', `${y + g.g / 2}px`);
  put(el, 'width', `${w}px`);
  put(el, 'height', `${hCells * g.p - g.g}px`);
  put(el, 'background-color', look.fill);
}
