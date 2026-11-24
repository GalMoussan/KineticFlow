/**
 * Magazine page (see meta). Everything is fitted inside the safe area minus a few pixels, at the camera's hold zoom,
 * so the hold ink sits inside the safe box in every format. Rules are `deco: 'rule'` so `mask-slide` grows them from
 * the start edge; the folio itself is not revealed (the page-turn carries it in).
 *
 * Word gaps are the measured space advance (`wordSpace`), in visual order. A prose drop cap is the first grapheme
 * of the first word, enlarged on that word's start edge and still part of the word. Short roles are one headline
 * size, plus a standfirst only when a clause break leaves two real phrases. Nothing is repeated as a pull quote.
 */
import { bidi, visualOrder } from '@reel/runtime';
import { defineLayout, type Host, type Metrics, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { advanceOf, fitRows, inkOf, packed, placeRows, row, setLine, tok, type Block, type Row } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.22;
const LEAD = 0.3;
/** Drop cap size ÷ the body size. The cap is the first grapheme, not the whole word. */
const DROP = 2.2;
const CAP_WT = 800;
const BODY_WT = 500;
const EMPH_WT = 650;
const FLOOR = 11;
const COL_GAP = 22;
const SHORT = new Set(['title', 'cta', 'endcard']);

/** `unit.data.layout`. `drop` is set only on the word whose first grapheme is the drop cap. */
interface MagLayout {
  ink: string;
  drop?: { Sb: number };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Glyph {
  index: number;
  S: number;
  wt: number;
  family: 'display' | 'text';
  m: Metrics;
  /** Canvas pen, px from the left of the unit box. */
  pen: number;
}

interface DropRun {
  glyphs: Glyph[];
  w: number;
  /** Baseline measured from the top of the unit box (includes the top pad). */
  base: number;
  id: number;
  pad: number;
  inkX: number;
  inkY: number;
  inkW: number;
  inkH: number;
}

const KICKER: Record<string, readonly [string, string]> = {
  title: ['COVER', 'שער'],
  tagline: ['BRIEF', 'שורה'],
  body: ['FEATURE', 'כתבה'],
  teaser: ['NEXT', 'המשך'],
  cta: ['JOIN', 'הצטרפו'],
  heading: ['SECTION', 'מדור'],
  question: ['ASK', 'שאלה'],
  answer: ['ANSWER', 'תשובה'],
  quote: ['QUOTE', 'ציטוט'],
  datetime: ['WHEN', 'מתי'],
  location: ['WHERE', 'איפה'],
  list: ['LIST', 'רשימה'],
  stat: ['FIGURE', 'נתון'],
  countdown: ['COUNT', 'ספירה'],
  endcard: ['END', 'סיום'],
};

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    for (const s of layer.sections) {
      const z = host.zoomRange(s)[1];
      const left = safe.left + 8;
      const width = (safe.w - 16) / z;
      const folio = Math.max(28, Math.min(46, safe.h * 0.04));
      const top = safe.top + 4;
      const ruleY = top + folio;
      const bottomRule = safe.top + (safe.h - 14) / z;
      const content: Rect = { x: left, y: ruleY + 12, w: width, h: bottomRule - 12 - (ruleY + 12) };
      folioOf(host, s, left, width, top, folio);
      rule(host, s, left, ruleY, width, host.accent(0, s));
      rule(host, s, left, bottomRule, width, s.palette.text);

      const contentUnits = s.units.filter((u) => u.item >= 0);
      const words = contentUnits.filter((u) => u.kind !== 'logos');
      const logos = contentUnits.filter((u) => u.kind === 'logos');
      let box = content;
      if (logos.length && host.reel.logos.length) {
        const reserve = Math.min(content.h * 0.34, 280);
        box = { ...content, h: Math.max(40, content.h - reserve - 12) };
        placeBadge(host, s, logos[0]!, left, content.y + content.h - reserve, width, reserve);
      }
      const cap = (params.cap * Math.min(safe.w, safe.h)) / z;
      placeRole(host, s, words, box, cap);
      if (s.role === 'title') {
        const ws = words.filter((u) => u.kind === 'word');
        if (ws.length) ws.at(-1)!.tags.hero = true;
      }
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = null;
    }
  },
  /** After the grapheme split, sit each piece on the pen the layout measured. */
  mount({ host, layer }) {
    for (const s of layer.sections) for (const u of s.units) applyDrop(host, u);
  },
  /** The cap is accent and heavy; commit clears a part weight unless it is set every frame. */
  frame({ host, layer }) {
    for (const s of layer.sections) {
      for (const u of s.units) {
        const d = u.data.layout as MagLayout | undefined;
        const cap = d?.drop ? u.parts[0] : undefined;
        if (!cap) continue;
        cap.ch.color = host.accent(0, s);
        cap.ch.wght = CAP_WT;
      }
    }
  },
});

function folioOf(host: Host, s: Section, left: number, width: number, top: number, folio: number): void {
  const rtl = s.dir === 'rtl';
  const pair = KICKER[s.role] ?? (['FEATURE', 'כתבה'] as const);
  const label = pair[rtl ? 1 : 0]!;
  const S = Math.max(13, Math.min(22, folio * 0.48));
  const kick = host.deco(s, { deco: 'kicker', text: label, z: 2 });
  kick.ltr = !rtl;
  kick.revealed = false;
  kick.color = s.palette.text;
  const km = host.metrics(label, 600, kick.ltr, 'text');
  const base = top + km.ia * S + 2;
  const kx = rtl ? left + width - (km.bl + km.br) * S : left;
  setPlain(host, kick, label, kx, base, S, 600, 'text', kick.ltr);

  const num = String(s.index + 1);
  const page = host.deco(s, { deco: 'folio', text: num, z: 2 });
  page.ltr = true;
  page.revealed = false;
  page.color = host.accent(1, s);
  const pm = host.metrics(num, 650, true, 'text');
  const pw = (pm.bl + pm.br) * S;
  setPlain(host, page, num, rtl ? left : left + width - pw, base, S, 650, 'text', true);
}

/** A hairline the mask-slide reveal grows from the start edge. */
function rule(host: Host, s: Section, x: number, y: number, w: number, color: string): void {
  const u = host.deco(s, { deco: 'rule', z: 1 });
  u.box = { x, y, w, h: 3 };
  u.color = color;
  u.style = { background: color };
  u.revealed = true;
  u.at = s.timing.in;
  u.origin = s.dir === 'rtl' ? '100% 50%' : '0% 50%';
}

function setPlain(host: Host, u: Unit, text: string, x: number, base: number, S: number, wt: number, family: 'display' | 'text', ltr: boolean): void {
  u.text = text;
  u.ltr = ltr;
  const m = host.metrics(text, wt, ltr, family);
  const inkW = (m.bl + m.br) * S;
  const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
  u.font = { family, size: S, weight: wt };
  u.box = { x, y: base - m.ia * S, w: inkW, h: (m.ia + m.id) * S };
  u.textAt = { x: m.bl * S, y: base - mid - u.box.y };
  u.baseline = base;
  u.inkBox = { x: -m.bl * S, y: -m.ia * S + mid, w: inkW, h: (m.ia + m.id) * S };
}

function placeBadge(host: Host, s: Section, u: Unit, x: number, y: number, w: number, h: number): void {
  const b = logoBadge(host, s, host.reel.logos, w, {
    logoH: Math.max(48, h - 36),
    pad: 16,
    gap: 14,
    radius: 10,
    fill: s.palette.bg,
    border: host.accent(0, s),
    shadow: null,
  });
  u.box = { x: x + (w - b.w) / 2, y: y + Math.max(0, (h - b.h) / 2), w: b.w, h: b.h };
  u.textAt = { x: 0, y: 0 };
  u.innerStyle = { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` };
  u.mount = b.mount;
  u.mountKey = b.key;
  u.font = { family: 'display', size: 16, weight: 400 };
  u.tags.line = 8;
}

function placeRole(host: Host, s: Section, words: Unit[], box: Rect, cap: number): void {
  if (box.h < 16 || box.w < 16 || !words.length) return;
  const of = (...kinds: string[]) => words.filter((u) => kinds.includes(u.kind));
  switch (s.role) {
    case 'datetime':
      stack(host, s, [
        ...of('weekday').map((u) => row(0.42, [tok(u, 500, 'text')])),
        ...of('date').map((u) => row(1.65, [tok(u, 700, 'display')])),
        ...of('time').map((u) => row(0.55, [tok(u, 500, 'text')])),
      ], box, cap, 'center', true, 'body');
      return;
    case 'location':
      stack(host, s, [
        packed(1.05, of('place').map((u) => tok(u, 700, 'display'))),
        ...of('city').map((u) => row(0.55, [tok(u, 500, 'text')])),
      ], box, cap, 'center', true, 'body');
      return;
    case 'list': {
      const title = of('list-title');
      const items = of('list-item');
      let y = box.y;
      if (title.length) {
        const headH = Math.min(box.h * 0.28, 160);
        stack(host, s, title.map((u) => row(1, [tok(u, 700, 'display')])), { ...box, y, h: headH }, cap, 'start', true, 'headline');
        y += headH;
      }
      const rest: Rect = { ...box, y, h: box.y + box.h - y };
      if (items.length >= 4) itemColumns(host, s, items, rest, cap);
      else stack(host, s, items.map((u) => row(0.85, [tok(u, 500, 'text')])), rest, cap, 'start', false, 'body');
      return;
    }
    case 'stat':
    case 'countdown':
      stack(host, s, [
        ...of('stat', 'countdown').map((u) => row(1.8, [tok(u, 800, 'display')])),
        packed(0.6, of('word').map((u) => tok(u, 500, 'text'))),
      ], box, cap, 'center', true, 'body');
      return;
    default:
      if (SHORT.has(s.role)) headline(host, s, words, box, cap);
      else article(host, s, words, box, cap);
  }
}

/**
 * One display size for the whole line. A standfirst is a second block only when some word ends a clause and both
 * sides still have two words — a title is not cut in the middle of a phrase.
 */
function headline(host: Host, s: Section, words: Unit[], box: Rect, cap: number): void {
  const split = clauseSplit(words);
  const head = split ? split.head : words;
  const stand = split?.stand ?? [];
  if (!stand.length) {
    stack(host, s, [packed(1, head.map((u) => tok(u, 750, 'display')))], box, cap, 'center', box.w >= box.h, 'headline');
    return;
  }
  const headH = Math.max(48, box.h * 0.62);
  stack(host, s, [packed(1, head.map((u) => tok(u, 750, 'display')))], { ...box, h: headH }, cap, 'center', box.w >= box.h, 'headline');
  stack(host, s, [packed(1, stand.map((u) => tok(u, 500, 'text')))], { ...box, y: box.y + headH, h: box.h - headH }, cap * 0.46, 'center', box.w >= box.h, 'stand');
}

/** Index of the last headline word, or -1 when the line should stay one size. */
function clauseSplit(words: readonly Unit[]): { head: Unit[]; stand: Unit[] } | null {
  for (let i = 1; i < words.length - 2; i++) {
    if (!/[,:;!.?…]$/u.test(words[i]!.text)) continue;
    const head = words.slice(0, i + 1);
    const stand = words.slice(i + 1);
    if (head.length >= 2 && stand.length >= 2) return { head, stand };
  }
  return null;
}

/** Prose in order. Six or more words become two columns; the start column is read first and both tops align. */
function article(host: Host, s: Section, words: Unit[], box: Rect, cap: number): void {
  if (words.length >= 6 && proseColumns(host, s, words, box, cap)) return;
  const Sb = fitProse(host, words, box.w, box.h, cap, true);
  placeProse(host, s, words, box, Sb, true);
}

function proseColumns(host: Host, s: Section, words: Unit[], box: Rect, cap: number): boolean {
  const mid = Math.ceil(words.length / 2);
  const a = words.slice(0, mid);
  const b = words.slice(mid);
  if (!b.length) return false;
  const colW = (box.w - COL_GAP) / 2;
  if (colW < 40) return false;
  const Sb = fitPair(host, a, b, colW, box.h, cap);
  if (!fits(host, a, colW, box.h, Sb, true) || !fits(host, b, colW, box.h, Sb, false)) return false;
  const wA = columnWidth(host, a, colW, Sb, true);
  const wB = columnWidth(host, b, colW, Sb, false);
  const pair = wA + COL_GAP + wB;
  const origin = box.x + Math.max(0, (box.w - pair) / 2);
  const rtl = s.dir === 'rtl';
  const ax = rtl ? origin + wB + COL_GAP : origin;
  const bx = rtl ? origin : origin + wA + COL_GAP;
  placeProse(host, s, a, { x: ax, y: box.y, w: wA, h: box.h }, Sb, true);
  placeProse(host, s, b, { x: bx, y: box.y, w: wB, h: box.h }, Sb, false);
  return true;
}

/** List items stay one unit per row (their internal spaces are the unit's own). Two columns once there are four. */
function itemColumns(host: Host, s: Section, items: Unit[], box: Rect, cap: number): void {
  const mid = Math.ceil(items.length / 2);
  const a = items.slice(0, mid).map((u) => row(0.85, [tok(u, 500, 'text')]));
  const b = items.slice(mid).map((u) => row(0.85, [tok(u, 500, 'text')]));
  const colW = (box.w - COL_GAP) / 2;
  const fa = tryFit(host, a, colW, box.h, cap, false);
  const fb = tryFit(host, b, colW, box.h, cap, false);
  if (!fa || !fb) {
    stack(host, s, items.map((u) => row(0.85, [tok(u, 500, 'text')])), box, cap, 'start', false, 'body');
    return;
  }
  const size = Math.min(fa.size, fb.size);
  const rtl = s.dir === 'rtl';
  const ax = rtl ? box.x + colW + COL_GAP : box.x;
  const bx = rtl ? box.x : box.x + colW + COL_GAP;
  const opt = { width: colW, top: box.y, align: 'start' as const, dir: s.dir, gap: GAP, leading: LEAD, wordSpace: true };
  placeRows(host, fa.rows, size, { ...opt, left: ax });
  placeRows(host, fb.rows, size, { ...opt, left: bx });
  paint(fa.rows, s, host, 'body');
  paint(fb.rows, s, host, 'body');
}

function stack(host: Host, s: Section, blocks: Block[], box: Rect, cap: number, align: 'center' | 'start', wide: boolean, kind: 'headline' | 'stand' | 'body'): void {
  const fit = tryFit(host, blocks, box.w, box.h, cap, wide);
  if (!fit || box.h < 8) return;
  placeRows(host, fit.rows, fit.size, {
    left: box.x,
    width: box.w,
    top: box.y,
    align,
    dir: s.dir,
    gap: GAP,
    leading: LEAD,
    wordSpace: true,
  });
  paint(fit.rows, s, host, kind);
}

function tryFit(host: Host, blocks: Block[], w: number, h: number, cap: number, wide: boolean): { rows: Row[]; size: number } | null {
  const live = blocks.filter((b) => (b.kind === 'row' ? b.row.kind === 'box' || b.row.toks.length : b.toks.length));
  if (!live.length || w < 8 || h < 8) return null;
  const fit = fitRows(host, live, { w, h, cap, gap: GAP, leading: LEAD, wide, wordSpace: true });
  if (!Number.isFinite(fit.size) || fit.size < 1) return null;
  return fit;
}

function paint(rows: readonly Row[], s: Section, host: Host, kind: 'headline' | 'stand' | 'body'): void {
  for (const r of rows) {
    if (r.kind !== 'text') continue;
    for (const t of r.toks) mark(host, s, t.u, kind);
  }
}

function mark(host: Host, s: Section, u: Unit, kind: 'headline' | 'stand' | 'body'): void {
  const numeric = u.kind === 'date' || u.kind === 'time' || u.kind === 'stat' || u.kind === 'countdown';
  const ink = numeric ? host.accent(1, s) : kind === 'headline' || u.emphasis ? host.accent(0, s) : s.palette.text;
  const prev = u.data.layout as MagLayout | undefined;
  u.data.layout = prev?.drop ? { ink, drop: prev.drop } : { ink };
  if (numeric) u.tags.numeric = true;
}

function bodyWt(u: Unit): number {
  return u.emphasis ? EMPH_WT : BODY_WT;
}

function spacePx(host: Host, Sb: number): number {
  const w = host.metrics(' ', BODY_WT, true, 'text').w;
  return (w && w > 0 ? w : 0.25) * Sb;
}

function plainAdvance(host: Host, u: Unit, Sb: number): number {
  return advanceOf(inkOf(host, tok(u, bodyWt(u), 'text'))) * Sb;
}

/** Grapheme clusters, in logical order. Niqqud stays on its letter. */
function graphemes(text: string): string[] {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined;
  const out: string[] = [];
  for (const s of new Intl.Segmenter(lang, { granularity: 'grapheme' }).segment(text)) out.push(s.segment);
  return out.length ? out : [text];
}

/** Logical grapheme indices in left-to-right visual order. */
function visualIndices(gs: readonly string[], dir: 'rtl' | 'ltr'): number[] {
  if (gs.length <= 1) return gs.map((_, i) => i);
  const starts: number[] = [];
  let n = 0;
  let text = '';
  for (const g of gs) {
    starts.push(n);
    text += g;
    n += g.length;
  }
  const visual = bidi.getReorderedIndices(text, bidi.getEmbeddingLevels(text, dir));
  const pos = new Int32Array(text.length);
  visual.forEach((logical, x) => {
    pos[logical] = x;
  });
  return gs.map((_, i) => i).sort((a, b) => (pos[starts[a]!] ?? 0) - (pos[starts[b]!] ?? 0) || a - b);
}

/**
 * The first grapheme at `DROP` × body, on the word's start edge (left in LTR, right in RTL). The remaining
 * graphemes sit on the same baseline, a hairline past the cap's ink — not a word space. Side pads keep the
 * enlarged ink inside the unit box, which is also the mask.
 */
function dropRun(host: Host, u: Unit, Sb: number): DropRun {
  const ltr = u.ltr;
  const dir: 'rtl' | 'ltr' = ltr ? 'ltr' : 'rtl';
  const gs = graphemes(u.text);
  const Sd = DROP * Sb;
  const padX = Math.max(3, 0.08 * Sd);
  const padY = Math.max(3, 0.12 * Sd);
  const hair = gs.length > 1 ? Math.max(1.5, 0.05 * Sb) : 0;
  const wt = bodyWt(u);
  // Spans are pinned LTR (pen = left edge), so the grapheme metrics use the same direction.
  const mCap = host.metrics(gs[0]!, CAP_WT, true, 'display');
  const rest = gs.slice(1);
  const restM = rest.map((g) => host.metrics(g, wt, true, 'text'));
  const penBy = new Array<number>(gs.length).fill(0);

  if (ltr) {
    penBy[0] = 0;
    if (rest.length) {
      const order = visualIndices(rest, dir);
      const first = order[0]!;
      let pen = mCap.br * Sd + hair + restM[first]!.bl * Sb;
      for (const ri of order) {
        penBy[ri + 1] = pen;
        pen += advanceOf(restM[ri]!) * Sb;
      }
    }
  } else if (!rest.length) {
    penBy[0] = 0;
  } else {
    const order = visualIndices(rest, dir);
    let pen = 0;
    for (const ri of order) {
      penBy[ri + 1] = pen;
      pen += advanceOf(restM[ri]!) * Sb;
    }
    const right = order[order.length - 1]!;
    const restInkRight = penBy[right + 1]! + restM[right]!.br * Sb;
    penBy[0] = restInkRight + hair + mCap.bl * Sd;
  }

  const glyphAt = (index: number): Glyph => {
    const capG = index === 0;
    return {
      index,
      S: capG ? Sd : Sb,
      wt: capG ? CAP_WT : wt,
      family: capG ? 'display' : 'text',
      m: capG ? mCap : restM[index - 1]!,
      pen: penBy[index]!,
    };
  };
  const glyphs = gs.map((_, i) => glyphAt(i));
  const inkLeft = (g: Glyph) => g.pen - g.m.bl * g.S;
  const inkRight = (g: Glyph) => g.pen + g.m.br * g.S;
  const shift = padX - Math.min(...glyphs.map(inkLeft));
  for (const g of glyphs) g.pen += shift;
  const ia = Math.max(...glyphs.map((g) => g.m.ia * g.S));
  const id = Math.max(...glyphs.map((g) => g.m.id * g.S));
  const right = Math.max(...glyphs.map(inkRight)) + padX;
  const base = padY + ia;
  return {
    glyphs,
    w: right,
    base,
    id,
    pad: padY,
    inkX: Math.min(...glyphs.map(inkLeft)),
    inkY: padY,
    inkW: Math.max(...glyphs.map(inkRight)) - Math.min(...glyphs.map(inkLeft)),
    inkH: ia + id,
  };
}

interface LineBox {
  ascent: number;
  descent: number;
  width: number;
}

function lineBox(host: Host, line: readonly Unit[], Sb: number, drop: Unit | null): LineBox {
  let ascent = 0;
  let descent = 0;
  let width = 0;
  for (const u of line) {
    if (u === drop) {
      const r = dropRun(host, u, Sb);
      ascent = Math.max(ascent, r.base);
      descent = Math.max(descent, r.id + r.pad);
      width += r.w;
    } else {
      const m = inkOf(host, tok(u, bodyWt(u), 'text'));
      ascent = Math.max(ascent, m.ia * Sb);
      descent = Math.max(descent, m.id * Sb);
      width += advanceOf(m) * Sb;
    }
  }
  width += spacePx(host, Sb) * Math.max(0, line.length - 1);
  return { ascent, descent, width };
}

function wrapWords(host: Host, words: readonly Unit[], maxW: number, Sb: number, dropFirst: boolean): Unit[][] {
  const lines: Unit[][] = [];
  let cur: Unit[] = [];
  const widthOf = (line: readonly Unit[]) => {
    const drop = dropFirst && line[0] === words[0] ? words[0]! : null;
    return lineBox(host, line, Sb, drop).width;
  };
  for (const u of words) {
    if (cur.length && widthOf([...cur, u]) > maxW) {
      lines.push(cur);
      cur = [u];
    } else cur.push(u);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function columnLines(host: Host, words: readonly Unit[], maxW: number, Sb: number, dropFirst: boolean): Unit[][] {
  return wrapWords(host, words, maxW, Sb, dropFirst);
}

function stackHeight(host: Host, words: readonly Unit[], maxW: number, Sb: number, dropFirst: boolean): number {
  const lines = columnLines(host, words, maxW, Sb, dropFirst);
  let y = 0;
  lines.forEach((line, i) => {
    const drop = dropFirst && i === 0 ? words[0]! : null;
    const b = lineBox(host, line, Sb, drop);
    if (i) y += LEAD * Sb;
    y += b.ascent + b.descent;
  });
  return y;
}

function fits(host: Host, words: readonly Unit[], maxW: number, maxH: number, Sb: number, dropFirst: boolean): boolean {
  const lines = columnLines(host, words, maxW, Sb, dropFirst);
  for (let i = 0; i < lines.length; i++) {
    const drop = dropFirst && i === 0 ? words[0]! : null;
    if (lineBox(host, lines[i]!, Sb, drop).width > maxW + 0.5) return false;
  }
  return stackHeight(host, words, maxW, Sb, dropFirst) <= maxH + 0.5;
}

function searchSb(host: Host, words: readonly Unit[], maxW: number, maxH: number, cap: number, dropFirst: boolean): number {
  const hi0 = Math.max(FLOOR, Math.min(dropFirst ? cap / DROP : cap, maxH));
  let lo = FLOOR;
  let hi = hi0;
  let best = FLOOR;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (fits(host, words, maxW, maxH, mid, dropFirst)) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

function fitProse(host: Host, words: readonly Unit[], maxW: number, maxH: number, cap: number, dropFirst: boolean): number {
  return searchSb(host, words, maxW, maxH, cap, dropFirst);
}

function fitPair(host: Host, a: readonly Unit[], b: readonly Unit[], colW: number, maxH: number, cap: number): number {
  const hi0 = Math.max(FLOOR, Math.min(cap / DROP, maxH));
  let lo = FLOOR;
  let hi = hi0;
  let best = FLOOR;
  const ok = (Sb: number) => fits(host, a, colW, maxH, Sb, true) && fits(host, b, colW, maxH, Sb, false);
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

function columnWidth(host: Host, words: readonly Unit[], maxW: number, Sb: number, dropFirst: boolean): number {
  const lines = columnLines(host, words, maxW, Sb, dropFirst);
  let w = 0;
  lines.forEach((line, i) => {
    const drop = dropFirst && i === 0 ? words[0]! : null;
    w = Math.max(w, lineBox(host, line, Sb, drop).width);
  });
  return Math.min(maxW, Math.max(8, w));
}

function placeProse(host: Host, s: Section, words: Unit[], box: Rect, Sb: number, dropFirst: boolean): void {
  const lines = columnLines(host, words, box.w, Sb, dropFirst);
  let y = box.y;
  lines.forEach((line, i) => {
    const drop = dropFirst && i === 0 ? words[0]! : null;
    y = placeLine(host, s, line, box.x, box.w, y, Sb, i, drop) + LEAD * Sb;
  });
}

/** Sets one line in visual order. Returns the line's bottom (before the leading). */
function placeLine(host: Host, s: Section, line: readonly Unit[], left: number, width: number, top: number, Sb: number, lineNo: number, drop: Unit | null): number {
  const dir = s.dir;
  const rtl = dir === 'rtl';
  const space = spacePx(host, Sb);
  const box = lineBox(host, line, Sb, drop);
  const origin = rtl ? left + width - box.width : left;
  // Direction marks, not the raw characters: `ב-WhatsApp` must sit as one word between הַרְשָׁמָה and the number.
  const order = visualOrder(
    line.map((u) => (u.ltr ? '\u200E' : '\u200F')),
    dir,
  ).map((i) => line[i]!);
  const base = top + box.ascent;
  let x = origin;
  for (const u of order) {
    if (u === drop) {
      const run = dropRun(host, u, Sb);
      const y = base - run.base;
      u.font = { family: 'text', size: Sb, weight: bodyWt(u) };
      u.box = { x, y, w: run.w, h: run.base + run.id + run.pad };
      u.textAt = { x: 0, y: 0 };
      u.baseline = base;
      u.inkBox = { x: run.inkX, y: run.inkY, w: run.inkW, h: run.inkH };
      u.innerOrigin = `${(run.w / 2).toFixed(2)}px ${(u.box.h / 2).toFixed(2)}px`;
      u.split = 'grapheme';
      u.tags.line = lineNo;
      u.data.layout = { ink: s.palette.text, drop: { Sb } };
      mark(host, s, u, 'body');
      x += run.w + space;
    } else {
      setLine(host, [tok(u, bodyWt(u), 'text')], dir, x, base, Sb, GAP, lineNo, true);
      mark(host, s, u, 'body');
      x += plainAdvance(host, u, Sb) + space;
    }
  }
  return base + box.descent;
}

/** Moves the split spans onto the drop-cap run. The unit box already contains the enlarged grapheme. */
function applyDrop(host: Host, u: Unit): void {
  const d = (u.data.layout as MagLayout | undefined)?.drop;
  if (!d || !u.inner || !u.parts.length) return;
  const run = dropRun(host, u, d.Sb);
  u.inner.style.width = `${run.w.toFixed(2)}px`;
  u.inner.style.height = `${u.box.h.toFixed(2)}px`;
  const fam = (family: 'display' | 'text') => (family === 'text' ? 'var(--textfont)' : 'var(--display)');
  for (const g of run.glyphs) {
    const p = u.parts[g.index];
    if (!p) continue;
    const span = p.span;
    const mid = g.S / 2 + ((g.m.fa - g.m.fd) * g.S) / 2;
    span.style.right = 'auto';
    span.style.direction = 'ltr';
    span.style.unicodeBidi = 'isolate';
    span.style.textAlign = 'left';
    span.style.fontFamily = `${fam(g.family)}, sans-serif`;
    span.style.fontSize = `${g.S.toFixed(2)}px`;
    span.style.lineHeight = '1';
    span.style.left = `${g.pen.toFixed(2)}px`;
    span.style.top = `${(run.base - mid).toFixed(2)}px`;
  }
}
