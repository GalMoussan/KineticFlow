/**
 * Ink-tight row stacks for the M7 card/stack layouts (luxe-frame, info-card, stat-board, list-stack): the
 * `center-stack` recipe (Canvas2D ink metrics, words spaced ink to ink by `gap` em, boxes padded around the ink, the
 * inner element placed so its ink sits on the baseline) as small functions, plus row packing, fitting and placing.
 * Lines are set left to right in bidi visual order.
 */
import { visualOrder } from '@reel/runtime';
import type { Host, Metrics, Unit } from '../contract.ts';
import { blockFs, subScale } from './subline.ts';

/** One unit on a line, with the weight (and font slot) it is set in. */
export interface Tok {
  u: Unit;
  wt: number;
  family?: 'display' | 'text';
}

/** Box padding around the ink, em. */
export const PAD = { x: 0.08, y: 0.12 } as const;

export const tok = (u: Unit, wt: number, family: 'display' | 'text' = 'display'): Tok => ({ u, wt, family });

export const inkOf = (host: Host, t: Tok): Metrics => host.metrics(t.u.text, t.wt, t.u.ltr, t.family ?? 'display');

/** Ink extents of tokens set on one line, per 1 px of font size: width (ink to ink, `gap` em apart), ascent, descent. */
export function lineDims(host: Host, toks: readonly Tok[], gap: number): { w: number; ia: number; id: number } {
  if (!toks.length) return { w: 0, ia: 0, id: 0 };
  const ms = toks.map((t) => inkOf(host, t));
  return {
    w: ms.reduce((a, m) => a + m.bl + m.br, 0) + gap * (toks.length - 1),
    ia: Math.max(...ms.map((m) => m.ia)),
    id: Math.max(...ms.map((m) => m.id)),
  };
}

/** Visual (left-to-right) order of a line's tokens. */
export const visual = (toks: readonly Tok[], dir: 'rtl' | 'ltr'): Tok[] => visualOrder(toks.map((t) => t.u.text), dir).map((i) => toks[i]!);

/**
 * Sets `toks` on one line at font size `S`: the ink run starts at x = `left`, glyphs sit on `base`. Writes each
 * unit's font, box, textAt, inkBox, baseline, innerOrigin and `tags.line`. Returns the ink run's right edge.
 */
export function setLine(host: Host, toks: readonly Tok[], dir: 'rtl' | 'ltr', left: number, base: number, S: number, gap: number, line: number): number {
  let x = left;
  for (const t of visual(toks, dir)) {
    const m = inkOf(host, t);
    const inkW = (m.bl + m.br) * S;
    const x0 = x;
    x += inkW + gap * S;
    const box = { x: x0 - PAD.x * S, y: base - m.ia * S - PAD.y * S, w: inkW + 2 * PAD.x * S, h: (m.ia + m.id + 2 * PAD.y) * S };
    const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
    const inkBox = { x: -m.bl * S, y: -m.ia * S + mid, w: inkW, h: (m.ia + m.id) * S };
    Object.assign(t.u, {
      box,
      baseline: base,
      font: { family: t.family ?? 'display', size: S, weight: t.wt },
      textAt: { x: x0 + m.bl * S - box.x, y: base - mid - box.y },
      inkBox,
      innerOrigin: `${(inkBox.x + inkW / 2).toFixed(2)}px ${(inkBox.y + inkBox.h / 2).toFixed(2)}px`,
    });
    t.u.tags.line = line;
  }
  return x - gap * S;
}

/**
 * Greedy line breaking in logical order: each line takes tokens while its ink width (per 1 px of font size) stays
 * within `maxW`; a token wider than `maxW` gets a line of its own.
 */
export function wrap(host: Host, toks: readonly Tok[], maxW: number, gap: number): Tok[][] {
  const lines: Tok[][] = [];
  let cur: Tok[] = [];
  let w = 0;
  for (const t of toks) {
    const m = inkOf(host, t);
    const tw = m.bl + m.br;
    if (cur.length && w + gap + tw > maxW) {
      lines.push(cur);
      cur = [];
      w = 0;
    }
    w += (cur.length ? gap : 0) + tw;
    cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Balanced wrap: the fewest lines greedy wrapping needs, with the narrowest width that keeps that line count. */
export function balance(host: Host, toks: readonly Tok[], maxW: number, gap: number): Tok[][] {
  const n = wrap(host, toks, maxW, gap).length;
  let lo = Math.max(...toks.map((t) => {
    const m = inkOf(host, t);
    return m.bl + m.br;
  }));
  let hi = maxW;
  for (let i = 0; i < 18 && hi - lo > 1e-3; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(host, toks, mid, gap).length <= n) hi = mid;
    else lo = mid;
  }
  return wrap(host, toks, hi, gap);
}

/**
 * A text row (tokens at `f` × the base size; `indent` em kept free on its start side; `track` spreads its letters
 * about the row's centre by that share of their distance to it) or a box row (a badge, a bar: `w × h` per 1 px of
 * base size).
 */
export type Row =
  | { kind: 'text'; f: number; toks: Tok[]; indent?: number; track?: number }
  | { kind: 'box'; f: number; u: Unit; w: number; h: number };
/** A fixed row, or a run of tokens packed ≤ k per row at `f`. */
export type Block = { kind: 'row'; row: Row } | { kind: 'pack'; f: number; toks: Tok[] };

export const row = (f: number, toks: Tok[], indent = 0, track = 0): Block => ({ kind: 'row', row: { kind: 'text', f, toks, indent, track } });
export const packed = (f: number, toks: Tok[]): Block => ({ kind: 'pack', f, toks });

/**
 * Packs `subs` under the rows already in `blocks`, at `subScale` of those rows.
 * Returns the same array when `subs` is empty (no-sub geometry stays the caller's).
 */
export function appendSub(blocks: Block[], subs: readonly Tok[]): Block[] {
  if (!subs.length) return blocks;
  blocks.push(packed(subScale(blockFs(blocks)), [...subs]));
  return blocks;
}

/**
 * As `center-stack`: ⌈m/k⌉ rows of near-equal length (longer rows first); in runs of small words a word of ≤ 3
 * graphemes glues to the next one (or the previous one at the end of the run).
 */
export function pack(toks: readonly Tok[], k: number, f: number): Row[] {
  const chunks: Tok[][] = [];
  let glue: Tok[] = [];
  for (const t of toks) {
    glue.push(t);
    if (f >= 1 || t.u.graphemes > 3 || t.u.emphasis) {
      chunks.push(glue);
      glue = [];
    }
  }
  if (glue.length) {
    if (chunks.length) chunks.at(-1)!.push(...glue);
    else chunks.push(glue);
  }
  const n = Math.ceil(chunks.length / k);
  const base = Math.floor(chunks.length / n);
  const extra = chunks.length - base * n;
  const rows: Row[] = [];
  let i = 0;
  for (let r = 0; r < n; r++) {
    const len = base + (r < extra ? 1 : 0);
    rows.push({ kind: 'text', f, toks: chunks.slice(i, i + len).flat() });
    i += len;
  }
  return rows;
}

/** Extents of a row at base size 1 (× its f): width (incl. indent and tracking), ink ascent, ink descent. */
export function rowDims(host: Host, r: Row, gap: number): { w: number; ia: number; id: number } {
  if (r.kind === 'box') return { w: r.w, ia: r.h, id: 0 };
  const d = lineDims(host, r.toks, gap);
  return { w: (d.w * (1 + (r.track ?? 0)) + (r.indent ?? 0)) * r.f, ia: d.ia * r.f, id: d.id * r.f };
}

/** Height of `rows` at base size 1: rows plus `leading` em (mean of both rows' f) between them. */
export function stackHeight(host: Host, rows: readonly Row[], gap: number, leading: number): number {
  let h = 0;
  rows.forEach((r, i) => {
    const d = rowDims(host, r, gap);
    h += d.ia + d.id;
    if (i) h += (leading * (rows[i - 1]!.f + r.f)) / 2;
  });
  return h;
}

export interface FitOptions {
  /** Room for the stack, px. */
  w: number;
  h: number;
  /** Largest font size of any text row, px. */
  cap: number;
  gap: number;
  leading: number;
  /** Extra height per 1 px of base size (rules, padding that scale with the type). */
  extraH?: number;
  /** Wide frames prefer the largest k near the best size (rows of words), narrow ones the smallest. */
  wide: boolean;
}

/** Packs the blocks with the k (words per row) whose base size is best, as `center-stack` does. */
export function fitRows(host: Host, blocks: readonly Block[], o: FitOptions): { rows: Row[]; size: number } {
  const live = blocks.filter((b) => (b.kind === 'row' ? b.row.kind === 'box' || b.row.toks.length : b.toks.length));
  const maxK = Math.max(1, ...live.map((b) => (b.kind === 'pack' ? b.toks.length : 1)));
  const tries = Array.from({ length: maxK }, (_, i) => {
    const rows = live.flatMap((b): Row[] => (b.kind === 'row' ? [b.row] : pack(b.toks, i + 1, b.f)));
    const w = Math.max(...rows.map((r) => rowDims(host, r, o.gap).w));
    const h = stackHeight(host, rows, o.gap, o.leading) + (o.extraH ?? 0);
    const fmax = Math.max(0.01, ...rows.map((r) => (r.kind === 'text' ? r.f : 0)));
    return { rows, size: Math.min(o.w / w, o.h / h, o.cap / fmax) };
  });
  const best = Math.max(...tries.map((x) => x.size));
  const near = tries.filter((x) => x.size >= 0.92 * best);
  return o.wide ? near.at(-1)! : near[0]!;
}

/** Where a placed row ended up (group px): its horizontal extent, the centre letters track about, top, baseline, bottom. */
export interface RowRect {
  x0: number;
  x1: number;
  cx: number;
  top: number;
  base: number;
  bottom: number;
}

export interface PlaceOptions {
  /** The column rows align in: [left, left + width]. */
  left: number;
  width: number;
  top: number;
  /** Centred rows, or rows hugging the column's start edge (right in RTL). */
  align: 'center' | 'start';
  dir: 'rtl' | 'ltr';
  gap: number;
  leading: number;
}

/**
 * Sets every row from `top` down at base size `size`: text rows through `setLine` (`indent` em of the row's size
 * kept free on its start side; a tracked row is set plain in the middle of its tracked extent, and its units' ink
 * boxes are widened to where the tracking puts their letters), box rows by giving their unit the row's box.
 * Returns each row's rect.
 */
export function placeRows(host: Host, rows: readonly Row[], size: number, o: PlaceOptions): RowRect[] {
  const rtl = o.dir === 'rtl';
  let y = o.top;
  return rows.map((r, i) => {
    if (i) y += (o.leading * size * (rows[i - 1]!.f + r.f)) / 2;
    const d = rowDims(host, r, o.gap);
    const w = d.w * size;
    const x0 = o.align === 'center' ? o.left + (o.width - w) / 2 : rtl ? o.left + o.width - w : o.left;
    const top = y;
    const base = y + d.ia * size;
    let cx = x0 + w / 2;
    if (r.kind === 'box') {
      r.u.box = { x: x0, y, w, h: d.ia * size };
      r.u.tags.line = i;
    } else {
      const S = size * r.f;
      const ind = (r.indent ?? 0) * S;
      const tr = r.track ?? 0;
      const plain = lineDims(host, r.toks, o.gap).w * S;
      const left = (rtl ? x0 : x0 + ind) + (plain * tr) / 2;
      setLine(host, r.toks, o.dir, left, base, S, o.gap, i);
      cx = left + plain / 2;
      if (tr > 0) {
        for (const t of r.toks) {
          const u = t.u;
          const ink = u.inkBox!;
          const at = u.box.x + u.textAt.x;
          const g0 = at + ink.x;
          const g1 = g0 + ink.w;
          const n0 = g0 + (g0 - cx) * tr;
          const n1 = g1 + (g1 - cx) * tr;
          u.inkBox = { ...ink, x: n0 - at, w: n1 - n0 };
        }
      }
    }
    y = base + d.id * size;
    return { x0, x1: x0 + w, cx, top, base, bottom: y };
  });
}
