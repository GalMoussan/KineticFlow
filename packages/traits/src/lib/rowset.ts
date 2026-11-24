/**
 * Row typesetting shared by the beat/sticker/equalizer/karaoke/brutalist layouts: role-aware grouping of a section's
 * content units into rows (center-stack's rules, parametrised), ink-tight placement on a baseline (`host.metrics`, as
 * center-stack/world-blocks do), the k-words-per-row choice and the stack fit. Page-side only.
 */
import { visualOrder } from '@reel/runtime';
import type { Host, Metrics, Section, Unit } from '../contract.ts';
import { logoBadge, PIN_METRICS, pinSVG } from './deco.ts';

/** Unit box padding around the ink, em. */
export const PAD_X = 0.08;
export const PAD_Y = 0.12;
/** Logo badge, in units of the base size. */
export const BADGE = { logoH: 0.85, pad: 0.18, gap: 0.26, radius: 0.22 };

export interface Tok {
  u: Unit;
  wt: number;
  pin?: boolean;
}
export type Row = { kind: 'text'; f: number; toks: Tok[] } | { kind: 'badge'; f: number; u: Unit };
/** A fixed row, or a run of tokens packed ≤ k per row. */
export type Block = { kind: 'row'; row: Row } | { kind: 'pack'; f: number; toks: Tok[] };

/** A wanted weight clamped to what the font has (static fonts have one weight). */
export function weightOf(host: Host, wt: number, family: 'display' | 'text' = 'display'): number {
  const [lo, hi] = host.reel.fonts[family].weights;
  return Math.max(lo, Math.min(hi, wt));
}

export const tokMetrics = (host: Host, t: Tok): Metrics => (t.pin ? PIN_METRICS : host.metrics(t.u.text, t.wt, t.u.ltr, t.u.font.family));

export interface BlockOpts {
  /** Size of plain (non-emphasis) words, × the emphasis size. */
  plain: number;
  /** Weight of the big words (clamped to the font). */
  wt: number;
  /** Create a location pin before the place (coloured from the section palette). */
  pin: boolean;
}

/**
 * center-stack's role rules: emphasis and title words full size, plain words packed smaller, weekday/date/time,
 * pin/place/city, list title + items, number over label, end card words + logo badge. The title's last word is the
 * hero.
 */
export function roleBlocks(host: Host, s: Section, o: BlockOpts): Block[] {
  const content = s.units.filter((u) => u.item >= 0);
  const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
  const W = weightOf(host, o.wt);
  const tok = (u: Unit, wt = W): Tok => ({ u, wt: weightOf(host, wt) });
  const row = (f: number, toks: Tok[]): Block => ({ kind: 'row', row: { kind: 'text', f, toks } });
  const out: Block[] = [];
  switch (s.role) {
    case 'title':
    case 'cta': {
      const ws = of('word');
      if (s.role === 'title' && ws.length) ws.at(-1)!.tags.hero = true;
      out.push({ kind: 'pack', f: 1, toks: ws.map((u) => tok(u)) });
      break;
    }
    case 'datetime':
      for (const u of content) {
        if (u.kind === 'weekday') out.push(row(0.5, [tok(u, W - 200)]));
        else if (u.kind === 'date') out.push(row(1, [tok(u)]));
        else out.push(row(0.75, [tok(u)]));
      }
      break;
    case 'location': {
      const place = of('place');
      if (place.length) {
        if (o.pin) {
          const pin = host.deco(s, { deco: 'pin', at: Math.max(s.timing.in, place[0]!.at - 0.25), revealed: true, z: 1 });
          out.push(row(0.7, [{ u: pin, wt: W, pin: true }]));
        }
        out.push({ kind: 'pack', f: 0.9, toks: place.map((u) => tok(u)) });
      }
      for (const u of of('city')) out.push(row(0.5, [tok(u, W - 200)]));
      break;
    }
    case 'list':
      for (const u of of('list-title')) out.push(row(0.55, [tok(u, W - 200)]));
      for (const u of of('list-item')) out.push(row(o.plain, [tok(u)]));
      break;
    case 'stat':
    case 'countdown':
      for (const u of of('stat', 'countdown')) out.push(row(1.5, [tok(u)]));
      out.push({ kind: 'pack', f: 0.5, toks: of('word').map((u) => tok(u, W - 100)) });
      break;
    case 'endcard':
      out.push({ kind: 'pack', f: 0.75, toks: of('word').map((u) => tok(u)) });
      for (const u of of('logos')) out.push({ kind: 'row', row: { kind: 'badge', f: 1, u } });
      break;
    case 'lyric':
      for (const u of of('lyric')) out.push(row(1, [tok(u)]));
      break;
    default: {
      let run: Tok[] = [];
      const flush = () => {
        if (run.length) out.push({ kind: 'pack', f: o.plain, toks: run });
        run = [];
      };
      for (const u of of('word')) {
        if (u.emphasis) {
          flush();
          out.push(row(1, [tok(u)]));
        } else run.push(tok(u));
      }
      flush();
    }
  }
  return out.filter((b) => b.kind === 'row' || b.toks.length);
}

/**
 * Packs a run into ⌈m/k⌉ rows of near-equal length (longer rows first), counting chunks: in runs of plain (smaller)
 * words, a word of ≤ 3 graphemes is glued to the next word (or to the previous one at the end of the run).
 */
export function pack(toks: Tok[], k: number, f: number): Row[] {
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

/** Rows of `blocks` with runs packed ≤ k per row. */
export const expand = (blocks: Block[], k: number): Row[] =>
  blocks.flatMap((b): Row[] => (b.kind === 'row' ? [b.row] : pack(b.toks, k, b.f)));

/** Largest run length (the k candidates go 1…this). */
export const maxRun = (blocks: Block[]) => Math.max(1, ...blocks.map((b) => (b.kind === 'pack' ? b.toks.length : 1)));

export interface StackOpts {
  /** Word gap inside a row, em. */
  gap: number;
  /** Gap between rows, em of the mean of both rows. */
  leading: number;
  /** Extra room above each row's ascent, em of the row (stretching letters). */
  headroom: number;
  /** Fit box (layer px). */
  fit: { x0: number; y0: number; x1: number; y1: number };
  /** Largest font size of an f = 1 row (px). */
  cap: number;
  /** Largest hold zoom (camera × rhythm). */
  hi: number;
  align: 'center' | 'start';
}

/** Badge size at base size 1. */
export function badgeDims(host: Host): { w: number; h: number } {
  const logos = host.reel.logos;
  return {
    w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
    h: BADGE.logoH + 2 * BADGE.pad,
  };
}

/** Ink extents of a row at base size 1 (already × its f): width, ascent, descent. */
export function rowDims(host: Host, r: Row, gap: number): { w: number; ia: number; id: number } {
  if (r.kind === 'badge') {
    const b = badgeDims(host);
    return { w: b.w, ia: b.h, id: 0 };
  }
  const ms = r.toks.map((t) => tokMetrics(host, t));
  const w = ms.reduce((a, m) => a + m.bl + m.br, 0) + gap * (r.toks.length - 1);
  return { w: w * r.f, ia: Math.max(...ms.map((m) => m.ia)) * r.f, id: Math.max(...ms.map((m) => m.id)) * r.f };
}

/** Total stack height at base size 1. */
function stackHeight(host: Host, rows: Row[], o: StackOpts): number {
  let h = 0;
  rows.forEach((r, i) => {
    const d = rowDims(host, r, o.gap);
    h += d.ia + d.id + (r.kind === 'text' ? o.headroom * r.f : 0);
    if (i) h += (o.leading * (rows[i - 1]!.f + r.f)) / 2;
  });
  return h;
}

/** Base size (f = 1) at which `rows` fit the box at the largest hold zoom. */
export function stackSize(host: Host, rows: Row[], o: StackOpts): number {
  const w = Math.max(...rows.map((r) => rowDims(host, r, o.gap).w));
  const fmax = Math.max(...rows.map((r) => (r.kind === 'text' ? r.f : 0.5)));
  return Math.min((o.fit.x1 - o.fit.x0) / w, (o.fit.y1 - o.fit.y0) / stackHeight(host, rows, o), o.cap / Math.max(1, fmax)) / o.hi;
}

/** center-stack's choice of k: among sizes ≥ keep × the best, the smallest k (narrow) or the largest (wide). */
export function chooseRows(host: Host, blocks: Block[], o: StackOpts, wide: boolean, minK = 1, keep = 0.92): { rows: Row[]; size: number } {
  const top = maxRun(blocks);
  const tries: { rows: Row[]; size: number }[] = [];
  for (let k = Math.min(minK, top); k <= top; k++) {
    const rows = expand(blocks, k);
    tries.push({ rows, size: stackSize(host, rows, o) });
  }
  const best = Math.max(...tries.map((x) => x.size));
  const near = tries.filter((x) => x.size >= keep * best);
  return wide ? near.at(-1)! : near[0]!;
}

/** Places one text token: ink left edge `x0`, baseline `base`, font size `S` (unit box padded around the ink). */
export function placeTok(u: Unit, m: Metrics, x0: number, base: number, S: number, wt: number): void {
  const inkW = (m.bl + m.br) * S;
  const box = { x: x0 - PAD_X * S, y: base - m.ia * S - PAD_Y * S, w: inkW + 2 * PAD_X * S, h: (m.ia + m.id + 2 * PAD_Y) * S };
  const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
  const inkBox = { x: -m.bl * S, y: -m.ia * S + mid, w: inkW, h: (m.ia + m.id) * S };
  Object.assign(u, {
    box,
    baseline: base,
    font: { family: u.font.family, size: S, weight: wt },
    textAt: { x: x0 + m.bl * S - box.x, y: base - mid - box.y },
    inkBox,
    innerOrigin: `${(inkBox.x + inkW / 2).toFixed(2)}px ${(inkBox.y + inkBox.h / 2).toFixed(2)}px`,
  });
}

/** Ink rect of a placed text unit in group coordinates. */
export function inkRect(u: Unit): { x0: number; y0: number; x1: number; y1: number } {
  const ink = u.inkBox ?? { x: 0, y: 0, w: u.box.w, h: u.box.h };
  const x0 = u.box.x + (u.inkBox ? u.textAt.x : 0) + ink.x;
  const y0 = u.box.y + (u.inkBox ? u.textAt.y : 0) + ink.y;
  return { x0, y0, x1: x0 + ink.w, y1: y0 + ink.h };
}

export interface RowGeom {
  row: Row;
  /** Font size of the row. */
  S: number;
  /** Top of the row's room (headroom included), baseline, bottom of the ink. */
  top: number;
  base: number;
  bottom: number;
  x0: number;
  x1: number;
}

export interface BadgeColors {
  fill: string;
  border: string;
  shadow: string | null;
}

/**
 * Places `rows` at base size `size`, vertically centred in the fit box, each row centred (or start-aligned in the
 * section's direction), tokens left to right in bidi visual order. Sets every unit's geometry, the section's place,
 * frame and bounds. Returns the rows' geometry.
 */
export function placeRows(host: Host, s: Section, rows: Row[], size: number, o: StackOpts, badge: BadgeColors): RowGeom[] {
  const rtl = s.dir === 'rtl';
  const ds = rows.map((r) => rowDims(host, r, o.gap));
  const total = stackHeight(host, rows, o) * size;
  const cx = (o.fit.x0 + o.fit.x1) / 2;
  let y = (o.fit.y0 + o.fit.y1) / 2 - total / 2;
  const out: RowGeom[] = [];
  let bx0 = Infinity;
  let bx1 = -Infinity;
  const by0 = y;
  rows.forEach((r, ri) => {
    if (ri) y += (o.leading * size * (rows[ri - 1]!.f + r.f)) / 2;
    const d = ds[ri]!;
    const width = d.w * size;
    const left = o.align === 'center' ? cx - width / 2 : rtl ? o.fit.x1 - width : o.fit.x0;
    bx0 = Math.min(bx0, left);
    bx1 = Math.max(bx1, left + width);
    if (r.kind === 'badge') {
      const b1 = badgeDims(host);
      const b = logoBadge(host, s, host.reel.logos, b1.w * size + 1, {
        logoH: BADGE.logoH * size,
        pad: BADGE.pad * size,
        gap: BADGE.gap * size,
        radius: BADGE.radius * size,
        fill: badge.fill,
        border: badge.border,
        shadow: badge.shadow,
      });
      const bl = o.align === 'center' ? cx - b.w / 2 : rtl ? o.fit.x1 - b.w : o.fit.x0;
      Object.assign(r.u, {
        box: { x: bl, y, w: b.w, h: b.h },
        innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
        mount: b.mount,
        mountKey: b.key,
        z: 1,
        font: { family: 'display', size, weight: 400 },
      });
      r.u.tags.line = ri;
      out.push({ row: r, S: size, top: y, base: y + b.h, bottom: y + b.h, x0: bl, x1: bl + b.w });
      y += b.h;
      return;
    }
    const S = size * r.f;
    const top = y;
    y += o.headroom * S;
    const base = y + d.ia * size;
    let x = left;
    const order = visualOrder(r.toks.map((t) => (t.pin ? (rtl ? '\u200F' : '\u200E') : t.u.text)), s.dir);
    for (const t of order.map((i) => r.toks[i]!)) {
      const m = tokMetrics(host, t);
      const inkW = (m.bl + m.br) * S;
      const u = t.u;
      u.tags.line = ri;
      if (t.pin) {
        Object.assign(u, {
          box: { x, y: base - m.ia * S, w: inkW, h: 0.9 * S },
          textAt: { x: 0, y: 0 },
          html: pinSVG(S, { body: host.accent(0, s), hole: s.palette.bg, shadow: 'transparent' }),
          font: { family: 'display', size: S, weight: t.wt },
          origin: '50% 100%',
        });
      } else placeTok(u, m, x, base, S, t.wt);
      x += inkW + o.gap * S;
    }
    y = base + d.id * size;
    out.push({ row: r, S, top, base, bottom: y, x0: left, x1: left + width });
  });
  s.place = { x: 0, y: 0, rot: 0 };
  s.frame = { x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 };
  s.bounds = { x0: bx0, y0: by0, x1: bx1, y1: y };
  return out;
}

/** Margin inside the safe area used by these layouts (px). */
export const safeMargin = (host: Host) => 8 + 0.03 * Math.min(host.safe.w, host.safe.h);

/** The safe area minus the margin, as a fit box. */
export function safeFit(host: Host): StackOpts['fit'] {
  const m = safeMargin(host);
  const { safe } = host;
  return { x0: safe.left + m, y0: safe.top + m, x1: safe.left + safe.w - m, y1: safe.top + safe.h - m };
}

/** Lighter / darker of the palette's text and background (badges, inks on accents). */
export function lightDark(s: Section): { light: string; dark: string } {
  const lum = (hex: string) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  const { bg, text } = s.palette;
  return lum(bg) >= lum(text) ? { light: bg, dark: text } : { light: text, dark: bg };
}

/** WCAG relative luminance of `#RRGGBB` (page-side: uses pow). */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/**
 * The palette's text or background colour to ink big type on `fill`: the light one whenever it reaches 3:1 (WCAG
 * large text; white on red/blue/violet reads as designed), else whichever contrasts more.
 */
export function inkOn(s: Section, fill: string): string {
  const { light, dark } = lightDark(s);
  const lf = luminance(fill);
  const cr = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const cl = cr(luminance(light), lf);
  return cl >= 3 || cl >= cr(luminance(dark), lf) ? light : dark;
}

/**
 * Font sizes of a column of one-unit rows: each row as wide as `w` allows (ink width `w1` per px of size), under one
 * common cap (≤ `capMax`), bisected so the column (ink heights `h1` + `leading` em gaps) fits `h`. Short words stop
 * growing first, long ones keep the full width.
 */
export function fitColumn(rows: readonly { w1: number; h1: number }[], w: number, h: number, leading: number, capMax: number): number[] {
  const sizes = (cap: number) => rows.map((r) => Math.min(w / r.w1, cap));
  const total = (cap: number) => {
    const S = sizes(cap);
    return S.reduce((a, v, i) => a + rows[i]!.h1 * v + (i ? (leading * (S[i - 1]! + v)) / 2 : 0), 0);
  };
  if (total(capMax) <= h) return sizes(capMax);
  let lo = 0;
  let hi = capMax;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (total(mid) <= h) lo = mid;
    else hi = mid;
  }
  return sizes(lo);
}

/** Height of a column with sizes `S` (see `fitColumn`). */
export const columnHeight = (rows: readonly { h1: number }[], S: readonly number[], leading: number): number =>
  S.reduce((a, v, i) => a + rows[i]!.h1 * v + (i ? (leading * (S[i - 1]! + v)) / 2 : 0), 0);
