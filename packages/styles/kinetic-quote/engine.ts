/**
 * Kinetic quote typography, ported from dilemma-reel `reel11.js`: one large paper world, every section typeset
 * into a justified block, and a single virtual camera that pans or turns 90° from block to block, with a small
 * scale kick on every landing. Everything (text, times, colours, font, logos, format) comes from `window.REEL`;
 * every frame is a pure function of t.
 *
 * - Line breaking: every title word, an emphasised word or a word of ≥ 6 graphemes gets its own line; other
 *   words pair up (≤ 2 per line). A single plain word that would justify larger than ACCENT_RATIO × the median
 *   justified size of the block's other lines becomes an aligned accent line (≤ ACCENT_SIZE world px),
 *   alternating right (weight 500, slideR) / left (accent 1, mask).
 * - Animation: plain words `mask`; emphasis rotates scale (accent 0) → drop + swipe (accent 2) → letters
 *   (accent 0); the title's last word drops in accent 4.
 * - Block rotation/direction cycles the reference sequence ROT_SEQ.
 */
import type { CueSheet, TextBox } from '@reel/core';
import {
  backOut,
  clamp01,
  decodeImages,
  defineReelPage,
  easeInOut,
  expo,
  hash,
  lerp,
  loadFonts,
  smooth,
  splitMeasured,
  type MeasuredUnit,
} from '@reel/runtime';

type ReelSection = CueSheet['sections'][number];

const REEL = window.REEL;
const { w: W, h: H, safe: SAFE } = REEL.format;
const PAL = REEL.palette;
const accent = (i: number) => PAL.accents[i % PAL.accents.length]!;
const FAMILY = REEL.fonts.display.family;
const DRIFT = REEL.params.drift ?? 0.04;
const KICK = REEL.params.kick ?? 0.008;

// ---------- constants (world px unless noted) ----------
const BW = 900; // block text width
const LEAD = 30; // leading between lines
const GAP_U = 0.22; // word gap in a justified line, as a fraction of the font size
const ACCENT_SIZE = 240;
const ACCENT_RATIO = 1.35;
const RULE_MIN = 120; // shortest rule beside an accent line
const FIT_MARGIN = 16; // screen px kept free inside the safe area
const GRID = 72; // dot-grid pitch; block origins sit on it
const GRID_EXT = GRID * 400;
const GRAIN_ALPHA = 0.06; // strongest speck opacity
const KICK_LEN = 0.9; // s
const INTRO_ZOOM = 1.75;
const LOGO_H = 240;
const BADGE_PAD = 44;
const BADGE_GAP = 56;
const ROT_SEQ: { rot: number; dir: 'left' | 'down' | null }[] = [
  { rot: 0, dir: null },
  { rot: 90, dir: 'left' },
  { rot: 90, dir: 'down' },
  { rot: 0, dir: 'left' },
  { rot: -90, dir: 'left' },
  { rot: -90, dir: 'left' },
  { rot: 0, dir: 'left' },
  { rot: 0, dir: 'down' },
];

// Screen: the fit box and the camera centre come from the safe area, not the whole frame.
const SAFE_W = W - SAFE.left - SAFE.right;
const SAFE_H = H - SAFE.top - SAFE.bottom;
const CX = SAFE.left + SAFE_W / 2;
const CY = SAFE.top + SAFE_H / 2;
const FIT_W = SAFE_W - 2 * FIT_MARGIN;
const FIT_H = SAFE_H - 2 * FIT_MARGIN;

// ---------- model ----------
type Anim = 'mask' | 'slideR' | 'drop' | 'scale' | 'letters' | 'slot';
type Align = 'left' | 'right' | null;

interface Metrics {
  bl: number;
  br: number;
  ia: number;
  id: number;
  fa: number;
  fd: number;
}

interface Word {
  section: string;
  /** Index into the section's items; -1 for the location pin (a decoration). */
  unit: number;
  text: string;
  wt: number;
  color: string;
  anim: Anim;
  at: number;
  ltr: boolean;
  pin: boolean;
  /** Counts as emphasis for line breaking (emphasised item or the title's last word). */
  strong: boolean;
  swipe: { color: string; at: number } | null;
  // layout
  mt: Metrics;
  size: number;
  inkW: number;
  ia: number;
  id: number;
  base: number;
  x0: number;
  x1: number;
  // DOM
  m: HTMLDivElement | null;
  inner: HTMLDivElement | null;
  ink: HTMLDivElement | null;
  swipeEl: HTMLDivElement | null;
  units: MeasuredUnit[];
  mW: number;
  mH: number;
}

type Line =
  | { kind: 'words'; align: Align; size: number; words: Word[] }
  | { kind: 'quote'; q: 'open' | 'close'; align: 'left' | 'right'; size: number; at: number }
  | { kind: 'badge'; section: string; unit: number; at: number };

interface Rule {
  x0: number;
  x1: number;
  y: number;
  at: number;
  from: 'left' | 'right';
  el: HTMLDivElement | null;
}

type Extra =
  | { kind: 'quote'; q: 'open' | 'close'; at: number; x: number; y: number; w: number; h: number; el: HTMLDivElement | null }
  | {
      kind: 'badge';
      section: string;
      unit: number;
      at: number;
      x: number;
      y: number;
      w: number;
      h: number;
      logos: { url: string; w: number; h: number }[];
      el: HTMLDivElement | null;
    };

interface Block {
  i: number;
  sec: ReelSection;
  rot: number;
  dir: 'left' | 'down' | null;
  drift: number;
  end: boolean;
  lines: Line[];
  words: Word[];
  rules: Rule[];
  extras: Extra[];
  h: number;
  first: number;
  last: number;
  top: number;
  bottom: number;
  /** Half extents including decorations, in block space. */
  hw: number;
  hh: number;
  s: number;
  x: number;
  y: number;
  el: HTMLDivElement | null;
  topRule: HTMLDivElement | null;
  topDot: HTMLDivElement | null;
  bar: HTMLDivElement | null;
}

interface Key {
  block: number;
  intro: boolean;
  x: number;
  y: number;
  rot: number;
  s: number;
  arrive: number;
  leave: number;
  drift: number;
  end: boolean;
}

const introCue = REEL.cues.cues.find((c) => c.type === 'intro');
const outroCue = REEL.cues.cues.find((c) => c.type === 'outro');
const blocks: Block[] = [];
let keys: Key[] = [];
let kicks: number[] = [];
let maxKick = 0;

// ---------- metrics (Canvas2D; deterministic) ----------
const mctx = document.createElement('canvas').getContext('2d')!;
const PIN_METRICS: Metrics = { bl: 0, br: 0.72, ia: 0.864, id: 0.04, fa: 0, fd: 0 };
const metricCache = new Map<string, Metrics>();
function metrics(text: string, wt: number, ltr: boolean): Metrics {
  const key = `${wt}|${ltr}|${text}`;
  let m = metricCache.get(key);
  if (!m) {
    mctx.font = `${wt} 100px "${FAMILY}"`;
    mctx.direction = ltr ? 'ltr' : 'rtl';
    mctx.textAlign = 'left';
    mctx.textBaseline = 'alphabetic';
    mctx.fontKerning = 'normal';
    const t = mctx.measureText(text);
    m = {
      bl: t.actualBoundingBoxLeft / 100,
      br: t.actualBoundingBoxRight / 100,
      ia: t.actualBoundingBoxAscent / 100,
      id: t.actualBoundingBoxDescent / 100,
      fa: t.fontBoundingBoxAscent / 100,
      fd: t.fontBoundingBoxDescent / 100,
    };
    metricCache.set(key, m);
  }
  return m;
}
const wordMetrics = (w: Word) => (w.pin ? PIN_METRICS : metrics(w.text, w.wt, w.ltr));
const inkAt1 = (w: Word) => {
  const m = wordMetrics(w);
  return m.bl + m.br;
};
/** Font size at which a line of words spans exactly BW. */
const justifiedSize = (ws: Word[]) => BW / (ws.reduce((a, w) => a + inkAt1(w), 0) + (ws.length - 1) * GAP_U);
/** Fixed size of an aligned accent line, shrunk if it would leave no room for its rule. */
const accentSize = (ws: Word[]) =>
  Math.min(ACCENT_SIZE, (BW - RULE_MIN - 40) / (ws.reduce((a, w) => a + inkAt1(w), 0) + (ws.length - 1) * 0.25));

// ---------- section → lines ----------
function word(section: string, unit: number, text: string, at: number, o: Partial<Word> = {}): Word {
  return {
    section, unit, text, at,
    wt: 800, color: PAL.text, anim: 'mask', ltr: false, pin: false, strong: false, swipe: null,
    mt: PIN_METRICS, size: 0, inkW: 0, ia: 0, id: 0, base: 0, x0: 0, x1: 0,
    m: null, inner: null, ink: null, swipeEl: null, units: [], mW: 0, mH: 0,
    ...o,
  };
}

let emphasisTurn = 0;
/** Emphasis words rotate through three treatments across the whole reel. */
function emphasise(w: Word): void {
  w.wt = 900;
  w.strong = true;
  switch (emphasisTurn++ % 3) {
    case 0:
      Object.assign(w, { anim: 'scale', color: accent(0) });
      break;
    case 1:
      Object.assign(w, { anim: 'drop', swipe: { color: accent(2), at: w.at + 0.15 } });
      break;
    default:
      Object.assign(w, { anim: 'letters', color: accent(0) });
  }
}

/** Own line for strong or long words, otherwise pairs. */
function pairUp(ws: Word[], graphemes: (w: Word) => number): Word[][] {
  const lines: Word[][] = [];
  let open: Word[] | null = null;
  for (const w of ws) {
    if (w.strong || graphemes(w) >= 6) {
      lines.push([w]);
      open = null;
    } else if (open) {
      open.push(w);
      open = null;
    } else {
      open = [w];
      lines.push(open);
    }
  }
  return lines;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
};

/** Justified lines, except lone plain words that would tower over the block: those become accent lines. */
function justifyOrAccent(groups: Word[][]): Line[] {
  const sizes = groups.map(justifiedSize);
  const candidate = groups.map((g) => g.length === 1 && !g[0]!.strong && !g[0]!.pin);
  const ref = sizes.filter((_, i) => !candidate[i]);
  const med = median(ref.length ? ref : sizes);
  let side = 0;
  return groups.map((g, i) => {
    if (!candidate[i] || sizes[i]! <= ACCENT_RATIO * med) return { kind: 'words', align: null, size: 0, words: g };
    const right = side++ % 2 === 0;
    for (const w of g) Object.assign(w, right ? { wt: 500, anim: 'slideR' } : { wt: 800, color: accent(1), anim: 'mask' });
    return { kind: 'words', align: right ? 'right' : 'left', size: accentSize(g), words: g };
  });
}

function sectionLines(sec: ReelSection, first: boolean): Line[] {
  const lines: Line[] = [];
  if (first && introCue) lines.push({ kind: 'quote', q: 'open', align: 'right', size: 270, at: introCue.t });
  const items = sec.items;
  const gr = new Map<Word, number>();
  const mk = (u: number, o: Partial<Word> = {}) => {
    const it = items[u]!;
    const w = word(sec.id, u, it.text, it.at, { ltr: it.ltr, ...o });
    gr.set(w, it.graphemes);
    return w;
  };
  const graphemes = (w: Word) => gr.get(w) ?? 0;

  switch (sec.role) {
    case 'datetime': {
      items.forEach((it, u) => {
        if (it.kind === 'weekday') {
          const w = mk(u, { wt: 500, anim: 'slideR' });
          lines.push({ kind: 'words', align: 'right', size: accentSize([w]), words: [w] });
        } else if (it.kind === 'date') {
          lines.push({ kind: 'words', align: null, size: 0, words: [mk(u, { wt: 800, anim: 'slot', ltr: true })] });
        } else {
          const w = mk(u, { wt: 400, color: accent(1), ltr: true });
          lines.push({ kind: 'words', align: 'left', size: accentSize([w]), words: [w] });
        }
      });
      break;
    }
    case 'location': {
      const place = items.flatMap((it, u) => (it.kind === 'place' ? [mk(u)] : []));
      for (const w of place) if (items[w.unit]!.emphasis) emphasise(w);
      const groups: Word[][] = [];
      if (place.length) {
        const p0 = place[0]!;
        const pin = word(sec.id, -1, '', Math.max(sec.timing.in, p0.at - 0.3), { pin: true, anim: 'drop', strong: true });
        groups.push([pin, p0], ...pairUp(place.slice(1), graphemes));
      }
      lines.push(...justifyOrAccent(groups));
      items.forEach((it, u) => {
        if (it.kind === 'city') {
          lines.push({ kind: 'words', align: null, size: 0, words: [mk(u, { wt: 500, anim: 'slideR', color: accent(1), strong: true })] });
        }
      });
      break;
    }
    default: {
      const titleLike = sec.role === 'title' || sec.role === 'endcard';
      const ws: Word[] = [];
      let badge: Line | null = null;
      items.forEach((it, u) => {
        if (it.kind === 'logos') badge = { kind: 'badge', section: sec.id, unit: u, at: it.at };
        // Title words are the hero: each gets its own justified line, like the reference.
        else ws.push(mk(u, titleLike ? { wt: 900, strong: sec.role === 'title' } : {}));
      });
      ws.forEach((w, k) => {
        if (titleLike && k === ws.length - 1) Object.assign(w, { anim: 'drop', color: accent(4), strong: true });
        else if (items[w.unit]!.emphasis) emphasise(w);
      });
      lines.push(...justifyOrAccent(pairUp(ws, graphemes)));
      if (badge) lines.push(badge);
    }
  }
  if (sec.role === 'endcard' && outroCue) lines.push({ kind: 'quote', q: 'close', align: 'left', size: 230, at: outroCue.t });
  return lines;
}

// ---------- block layout (block space: origin at the block centre, y down) ----------
function layoutBlock(b: Block): void {
  let y = 0;
  b.lines.forEach((ln, li) => {
    if (li) y += LEAD;
    if (ln.kind === 'quote') {
      const qw = ln.size;
      const qh = ln.size * 0.667;
      b.extras.push({ kind: 'quote', q: ln.q, at: ln.at, x: ln.align === 'right' ? BW / 2 - qw : -BW / 2, y, w: qw, h: qh, el: null });
      y += qh;
      return;
    }
    if (ln.kind === 'badge') {
      const src = REEL.logos;
      const natural = src.reduce((a, l) => a + (LOGO_H * l.w) / l.h, 0);
      const room = BW - 2 * BADGE_PAD - BADGE_GAP * (src.length - 1);
      const lh = natural > room ? (LOGO_H * room) / natural : LOGO_H;
      const logos = src.map((l) => ({ url: l.url, w: (lh * l.w) / l.h, h: lh }));
      const bw = logos.reduce((a, l) => a + l.w, 0) + BADGE_GAP * (logos.length - 1) + 2 * BADGE_PAD;
      const bh = lh + 2 * BADGE_PAD;
      b.extras.push({ kind: 'badge', section: ln.section, unit: ln.unit, at: ln.at, x: -bw / 2, y: y + 10, w: bw, h: bh, logos, el: null });
      y += bh + 30;
      return;
    }
    const ws = ln.words;
    for (const w of ws) w.mt = wordMetrics(w);
    let gap: number;
    if (ln.align) {
      for (const w of ws) w.size = ln.size;
      gap = ln.size * 0.25;
    } else {
      const k = justifiedSize(ws);
      for (const w of ws) w.size = k;
      gap = GAP_U * k;
    }
    for (const w of ws) {
      w.inkW = (w.mt.bl + w.mt.br) * w.size;
      w.ia = w.mt.ia * w.size;
      w.id = w.mt.id * w.size;
    }
    const asc = Math.max(...ws.map((w) => w.ia));
    const desc = Math.max(...ws.map((w) => w.id));
    y += asc;
    const base = y;
    y += desc;
    const total = ws.reduce((a, w) => a + w.inkW, 0) + gap * (ws.length - 1);
    let x = ln.align === 'left' ? -BW / 2 + total : BW / 2; // RTL: the first word sits on the right
    for (const w of ws) {
      w.base = base;
      w.x1 = x;
      w.x0 = x - w.inkW;
      x = w.x0 - gap;
      b.words.push(w);
    }
    const ruleAt = Math.max(...ws.map((w) => w.at)) + 0.12;
    const ry = base - Math.min(...ws.map((w) => w.ia)) * 0.42;
    if (ln.align === 'right') b.rules.push({ x0: -BW / 2, x1: ws.at(-1)!.x0 - 40, y: ry, at: ruleAt, from: 'right', el: null });
    if (ln.align === 'left') b.rules.push({ x0: ws[0]!.x1 + 40, x1: BW / 2, y: ry, at: ruleAt, from: 'left', el: null });
  });
  b.h = y;
  const dy = -y / 2; // centre the block on its origin
  for (const w of b.words) w.base += dy;
  for (const r of b.rules) r.y += dy;
  for (const e of b.extras) e.y += dy;
  const ats = [...b.words.map((w) => w.at), ...b.extras.map((e) => e.at)];
  b.first = Math.min(...ats);
  b.last = Math.max(...b.words.map((w) => w.at), ...b.extras.filter((e) => e.kind === 'badge').map((e) => e.at));
  b.top = dy - 52; // thin rule above, sage bar below
  b.bottom = -dy + 50;
  b.hw = BW / 2 + 44;
  b.hh = y / 2 + 62;
  // Content (BW × h) must stay inside the fit box at the largest hold scale: drift and kicks included.
  b.s = Math.min(FIT_W / BW, FIT_H / y) / ((1 + b.drift / 2) * (1 + maxKick) * 1.005);
}

// ---------- world placement: each block continues from the previous one, never visible during another's hold ----
const rotV = (deg: number, x: number, y: number): [number, number] => {
  const q = (((Math.round(deg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3; // block rotations are multiples of 90°
  const [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][q] as [number, number];
  return [x * c - y * s, x * s + y * c];
};
const side = (rot: number) => Math.abs(rot) % 180 === 90;
const aabb = (b: Block) => (side(b.rot) ? { hx: b.hh, hy: b.hw } : { hx: b.hw, hy: b.hh });
/** World half extents seen while holding on `b` (smallest hold scale, frame measured from the camera centre). */
const holdView = (b: Block) => {
  const s = b.s * (1 - b.drift / 2) * 0.99;
  const ex = Math.max(CX, W - CX) / s;
  const ey = Math.max(CY, H - CY) / s;
  return side(b.rot) ? { hx: ey, hy: ex } : { hx: ex, hy: ey };
};
type Ext = { hx: number; hy: number };
const hit = (ax: number, ay: number, a: Ext, bx: number, by: number, bb: Ext, m: number) =>
  Math.abs(ax - bx) < a.hx + bb.hx + m && Math.abs(ay - by) < a.hy + bb.hy + m;

function placeBlocks(): void {
  blocks[0]!.x = 0;
  blocks[0]!.y = 0;
  for (let i = 1; i < blocks.length; i++) {
    const p = blocks[i - 1]!;
    const b = blocks[i]!;
    const [ux, uy] = rotV(p.rot, b.dir === 'left' ? -1 : 0, b.dir === 'down' ? 1 : 0);
    const bb = aabb(b);
    const pb = aabb(p);
    // Distances snap to the grid pitch so the dot grid sits identically under every block.
    let d = Math.ceil((Math.abs(ux) * (pb.hx + bb.hx) + Math.abs(uy) * (pb.hy + bb.hy) + 80) / GRID) * GRID;
    for (let guard = 0; guard < 400; guard++, d += GRID) {
      b.x = p.x + ux * d;
      b.y = p.y + uy * d;
      let clash = false;
      for (let j = 0; j < i && !clash; j++) {
        const o = blocks[j]!;
        clash =
          hit(b.x, b.y, holdView(b), o.x, o.y, aabb(o), 30) ||
          hit(o.x, o.y, holdView(o), b.x, b.y, bb, 30) ||
          hit(b.x, b.y, bb, o.x, o.y, aabb(o), 200);
      }
      if (!clash) break;
    }
  }
}

// ---------- DOM ----------
const px = (v: number) => `${v.toFixed(2)}px`;
function el<K extends keyof HTMLElementTagNameMap = 'div'>(cls: string, parent: Element, st: Partial<CSSStyleDeclaration> = {}, tag = 'div' as K) {
  const e = document.createElement(tag);
  e.className = cls;
  Object.assign(e.style, st);
  parent.appendChild(e);
  return e;
}

// one "99" mark: round head + tapering tail (viewBox 0 0 64 100)
const MARK = 'M32 2 A28 28 0 1 1 31.9 2 Z M58 34 C60 64 44 88 12 99 L8 90 C28 79 36 64 34 52 Z';
const quoteSVG = (kind: 'open' | 'close', size: number) =>
  `<svg width="${size}" height="${size * 0.667}" viewBox="0 0 150 100" style="display:block;overflow:visible">` +
  `<g fill="${accent(0)}" transform="${kind === 'open' ? 'rotate(180 75 50)' : ''}"><path d="${MARK}"/>` +
  `<path transform="translate(80 0)" d="${MARK}"/></g></svg>`;
const pinSVG = (s: number) =>
  `<svg width="${s * 0.72}" height="${s * 0.9}" viewBox="0 0 100 125" style="display:block;overflow:visible">` +
  `<ellipse cx="50" cy="121" rx="26" ry="5" fill="${accent(3)}"/>` +
  `<path d="M50 4 C25 4 8 22 8 46 C8 76 50 120 50 120 C50 120 92 76 92 46 C92 22 75 4 50 4 Z" fill="${accent(1)}"/>` +
  `<circle cx="50" cy="45" r="16" fill="${PAL.bg}"/></svg>`;

const stage = document.getElementById('stage') as HTMLDivElement;
let world: HTMLDivElement;

function buildBlock(b: Block, images: Map<string, HTMLImageElement>): void {
  const bd = el('block', world, { left: px(b.x), top: px(b.y) });
  b.el = bd;
  b.topRule = el('rule', bd, { left: px(-BW / 2), width: px(BW), top: px(b.top), transformOrigin: '100% 50%' });
  b.topDot = el('dot', bd, { left: px(-BW / 2 - 30), top: px(b.top - 6.5) });
  b.bar = el('bar', bd, { left: px(BW / 2 - 150), width: '150px', top: px(b.bottom), transformOrigin: '100% 50%' });
  for (const w of b.words) {
    if (!w.swipe) continue;
    const S = w.size;
    w.swipeEl = el('swipe', bd, {
      left: px(w.x0 - 0.07 * S), width: px(w.inkW + 0.14 * S), top: px(w.base - w.ia * 0.58), height: px(w.ia * 0.58 + 0.1 * S),
      background: w.swipe.color, transformOrigin: '100% 50%',
    });
  }
  for (const r of b.rules) {
    r.el = el('rule', bd, { left: px(r.x0), width: px(Math.max(0, r.x1 - r.x0)), top: px(r.y - 1.5), transformOrigin: r.from === 'right' ? '100% 50%' : '0 50%' });
  }
  for (const w of b.words) {
    const S = w.size;
    const padX = 0.08 * S;
    const padY = 0.12 * S;
    const mL = w.x0 - padX;
    const mT = w.base - w.ia - padY;
    w.mW = w.inkW + 2 * padX;
    w.mH = w.ia + w.id + 2 * padY;
    const clip = w.anim === 'mask' || w.anim === 'slideR' || w.anim === 'letters' || w.anim === 'slot';
    w.m = el(clip ? 'm clip' : 'm', bd, { left: px(mL), top: px(mT), width: px(w.mW), height: px(w.mH) });
    if (w.pin) {
      w.inner = el('w', w.m, { left: px(padX), top: px(padY + w.ia - 0.864 * S) });
      w.inner.innerHTML = pinSVG(S);
      continue;
    }
    const left = w.x0 + w.mt.bl * S - mL;
    const top = w.base - (S / 2 + ((w.mt.fa - w.mt.fd) * S) / 2) - mT;
    w.inner = el(w.ltr ? 'w ltr' : 'w', w.m, {
      left: px(left), top: px(top), fontSize: px(S), fontWeight: String(w.wt), color: w.color, transformOrigin: '50% 60%',
    });
    w.inner.textContent = w.text;
    if (w.anim === 'letters' || w.anim === 'slot') w.units = splitMeasured(w.inner, 'grapheme').filter((u) => u.wordLike);
    // Invisible ink box (canvas metrics), moving with the word: what boxes() reports.
    w.ink = el('ink', w.inner, { left: px(-w.mt.bl * S), top: px(w.mt.ia * -S + S / 2 + ((w.mt.fa - w.mt.fd) * S) / 2), width: px(w.inkW), height: px(w.ia + w.id) });
  }
  for (const e of b.extras) {
    if (e.kind === 'quote') {
      e.el = el('m', bd, { left: px(e.x), top: px(e.y), width: px(e.w), height: px(e.h), transformOrigin: '50% 50%' });
      e.el.innerHTML = quoteSVG(e.q, e.w);
    } else {
      e.el = el('badge', bd, { left: px(e.x), top: px(e.y), width: px(e.w), height: px(e.h), gap: px(BADGE_GAP) });
      for (const l of e.logos) {
        const img = images.get(l.url)!.cloneNode() as HTMLImageElement;
        Object.assign(img.style, { width: px(l.w), height: px(l.h) });
        e.el.appendChild(img);
      }
    }
  }
  // Rotate only after splitMeasured has measured the untransformed text.
  bd.style.transform = `rotate(${b.rot}deg)`;
}

function buildGrid(): void {
  const g = el('', world, { left: px(-GRID_EXT), top: px(-GRID_EXT), width: px(2 * GRID_EXT), height: px(2 * GRID_EXT) });
  g.id = 'grid';
  world.insertBefore(g, world.firstChild);
}

// ---------- camera ----------
function buildKeys(): void {
  const A = blocks[0]!;
  const q = A.extras.find((e) => e.kind === 'quote' && e.q === 'open');
  keys = [];
  let firstArrive = A.sec.timing.in;
  if (introCue && q) {
    const [qx, qy] = rotV(A.rot, q.x + q.w / 2, q.y + q.h / 2 + 120);
    const leave = introCue.t + 0.05;
    keys.push({ block: 0, intro: true, x: A.x + qx, y: A.y + qy, rot: A.rot, s: A.s * INTRO_ZOOM, arrive: A.sec.timing.in, leave, drift: 0, end: false });
    // The camera leaves the opening quote, then arrives on the title just before its first landing.
    firstArrive = Math.min(A.sec.timing.holdStart, Math.max(leave + 0.3, A.sec.timing.firstLand - 0.05));
  }
  for (const b of blocks) {
    keys.push({
      block: b.i, intro: false, x: b.x, y: b.y, rot: b.rot, s: b.s,
      arrive: b.i === 0 ? firstArrive : b.sec.timing.in, leave: b.sec.timing.out, drift: b.drift, end: b.end,
    });
  }
}

interface Cam { x: number; y: number; r: number; s: number }
function hold(k: Key, t: number): Cam {
  const u = clamp01((t - k.arrive) / (k.leave - k.arrive));
  return { x: k.x, y: k.y, r: k.rot + (k.end || !k.drift ? 0 : 0.5 * (u - 0.5)), s: k.s * (1 - k.drift / 2 + k.drift * smooth(u)) };
}
function camera(t: number): Cam {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (i > 0 && t < k.arrive) {
      const p = keys[i - 1]!;
      const a = hold(p, p.leave);
      const b = hold(k, k.arrive);
      const e = easeInOut(clamp01((t - p.leave) / (k.arrive - p.leave)));
      const turn = Math.abs(b.r - a.r) > 45 ? 0.38 : 0.22;
      return {
        x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), r: lerp(a.r, b.r, e),
        s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), e)) * (1 - turn * Math.sin(Math.PI * e)),
      };
    }
    if (t < k.leave || i === keys.length - 1) return hold(k, t);
  }
  return hold(keys.at(-1)!, t);
}
const kickAt = (t: number) => {
  let k = 0;
  for (const a of kicks) {
    const d = t - a;
    if (d >= 0 && d < KICK_LEN) k += KICK * Math.exp(-d * 6);
  }
  return k;
};

// ---------- paper + grain (static, sized to the format) ----------
const rgba = (hex: string, a: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
function drawPaper(paper: HTMLCanvasElement, grain: HTMLCanvasElement): void {
  const g = paper.getContext('2d')!;
  g.fillStyle = PAL.bg;
  g.fillRect(0, 0, W, H);
  const scale = Math.max(W, H) / 1920;
  for (let i = 0; i < 14; i++) {
    const x = hash(i + 3) * W;
    const y = hash(i + 41) * H;
    const r = (220 + hash(i + 77) * 520) * scale;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, i % 3 === 0 ? rgba(accent(2), 0.07) : i % 3 === 1 ? rgba(accent(3), 0.06) : 'rgba(255,250,240,0.22)');
    gr.addColorStop(1, rgba(PAL.bg, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = rgba(PAL.text, 0.035);
  g.lineWidth = 1;
  const fibres = Math.round((90 * W * H) / (1080 * 1920));
  for (let i = 0; i < fibres; i++) {
    const x = hash(i + 900) * W;
    const y = hash(i + 1900) * H;
    const a = hash(i + 2900) * Math.PI;
    const l = 20 + hash(i + 3900) * 70;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5 - 6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Grain over everything. The reference used a grey soft-light layer; a source-over layer of faint black/white
  // specks looks the same at this strength and halves the GPU render-order residue (≤ 1/255 instead of 2–3/255).
  const gg = grain.getContext('2d')!;
  const im = gg.createImageData(grain.width, grain.height);
  for (let i = 0; i < grain.width * grain.height; i++) {
    const v = hash(i * 1.37 + 0.5) * 2 - 1;
    const c = v > 0 ? 255 : 0;
    im.data[i * 4] = c;
    im.data[i * 4 + 1] = c;
    im.data[i * 4 + 2] = c;
    im.data[i * 4 + 3] = Math.round(Math.abs(v) * GRAIN_ALPHA * 255);
  }
  gg.putImageData(im, 0, 0);
}

// ---------- setup ----------
async function setup(): Promise<void> {
  const root = document.documentElement.style;
  root.setProperty('--bg', PAL.bg);
  root.setProperty('--text', PAL.text);
  for (let i = 0; i < 5; i++) root.setProperty(`--a${i}`, accent(i));
  root.setProperty('--display', `"${FAMILY}"`);
  Object.assign(stage.style, { width: `${W}px`, height: `${H}px` });

  const paper = el('', stage, {}, 'canvas');
  paper.id = 'paper';
  paper.width = W;
  paper.height = H;
  world = el('', stage);
  world.id = 'world';
  const grain = el('', stage, { width: `${W}px`, height: `${H}px` }, 'canvas');
  grain.id = 'grain';
  grain.width = Math.round(W / 2);
  grain.height = Math.round(H / 2);
  el('', stage).id = 'vignette';

  const [, imgs] = await Promise.all([loadFonts(REEL.fonts), decodeImages(REEL.logos.map((l) => l.url))]);
  const images = new Map(REEL.logos.map((l, i) => [l.url, imgs[i]!]));

  REEL.cues.sections.forEach((sec, i) => {
    const seq = ROT_SEQ[i % ROT_SEQ.length]!;
    const end = sec.role === 'endcard';
    blocks.push({
      i, sec, rot: seq.rot, dir: i === 0 ? null : (seq.dir ?? 'left'), drift: end ? DRIFT * 0.375 : DRIFT, end,
      lines: sectionLines(sec, i === 0), words: [], rules: [], extras: [],
      h: 0, first: 0, last: 0, top: 0, bottom: 0, hw: 0, hh: 0, s: 1, x: 0, y: 0, el: null, topRule: null, topDot: null, bar: null,
    });
  });
  kicks = blocks.flatMap((b) => b.lines.flatMap((l) => (l.kind === 'words' ? l.words.map((w) => w.at) : []))).sort((a, b) => a - b);
  // Largest kick: the sum peaks right at a landing.
  maxKick = Math.max(0, ...kicks.map(kickAt));

  for (const b of blocks) layoutBlock(b);
  placeBlocks();
  for (const b of blocks) buildBlock(b, images);
  buildGrid();
  buildKeys();
  drawPaper(paper, grain);
}

// ---------- per-frame animation ----------
const show = (e: HTMLElement, on: boolean) => {
  e.style.visibility = on ? 'visible' : 'hidden';
};
function animWord(w: Word, t: number): void {
  const st = w.at - 0.14;
  const e = expo(clamp01((t - st) / 0.5));
  if (w.swipe && w.swipeEl) {
    const q = expo(clamp01((t - w.swipe.at) / 0.38));
    show(w.swipeEl, q > 0);
    w.swipeEl.style.transform = `rotate(-1.4deg) scaleX(${q.toFixed(4)})`;
  }
  show(w.m!, t >= st);
  if (t < st) return;
  const s = w.inner!.style;
  switch (w.anim) {
    case 'mask':
      s.transform = `translateY(${px((1 - e) * w.mH)})`;
      break;
    case 'slideR':
      s.transform = `translateX(${px((1 - e) * w.mW * 0.85)})`;
      break;
    case 'drop': {
      const k = backOut(clamp01((t - st) / 0.42));
      s.transform = `translateY(${px(-(1 - k) * w.size * 0.55)})`;
      s.opacity = clamp01((t - st) * 8).toFixed(3);
      break;
    }
    case 'scale':
      s.transform = `scale(${lerp(1.45, 1, e).toFixed(4)}) rotate(${lerp(-5, 0, e).toFixed(3)}deg)`;
      s.opacity = clamp01((t - st) * 7).toFixed(3);
      break;
    case 'letters':
      w.units.forEach((u, i) => {
        const q = expo(clamp01((t - st - i * 0.05) / 0.42));
        u.span.style.transform = `translateY(${px((1 - q) * w.mH)})`;
      });
      break;
    case 'slot':
      w.units.forEach((u, i) => {
        const q = backOut(clamp01((t - st - i * 0.06) / 0.45), 1.2);
        u.span.style.transform = `translateY(${px(-(1 - q) * w.mH)})`;
      });
      break;
  }
}
function animBlock(b: Block, t: number): void {
  b.topRule!.style.transform = `scaleX(${expo(clamp01((t - (b.first - 0.35)) / 0.6)).toFixed(4)})`;
  b.topDot!.style.transform = `rotate(45deg) scale(${expo(clamp01((t - b.first) / 0.4)).toFixed(4)})`;
  b.bar!.style.transform = `scaleX(${expo(clamp01((t - b.last - 0.2) / 0.5)).toFixed(4)})`;
  for (const r of b.rules) r.el!.style.transform = `scaleX(${expo(clamp01((t - r.at) / 0.55)).toFixed(4)})`;
  for (const w of b.words) animWord(w, t);
  for (const e of b.extras) {
    const s = e.el!.style;
    if (e.kind === 'quote') {
      const st = e.q === 'open' ? e.at - 0.65 : e.at - 0.3;
      const k = clamp01((t - st) / 0.62);
      show(e.el!, t >= st);
      s.transform = `scale(${lerp(0.25, 1, backOut(k, 1.4)).toFixed(4)}) rotate(${lerp(e.q === 'open' ? -25 : 25, 0, expo(k)).toFixed(3)}deg)`;
    } else {
      const st = e.at - 0.12;
      const k = clamp01((t - st) / 0.5);
      show(e.el!, t >= st);
      s.opacity = clamp01(k * 3).toFixed(3);
      s.transform = `translateY(${px((1 - expo(k)) * 90)}) scale(${lerp(0.9, 1, backOut(k, 1.3)).toFixed(4)})`;
    }
  }
}

function seek(t: number): void {
  const cam = camera(t);
  const s = cam.s * (1 + kickAt(t));
  world.style.transform = `translate(${CX}px, ${CY}px) scale(${s.toFixed(5)}) rotate(${(-cam.r).toFixed(4)}deg) translate(${px(-cam.x)}, ${px(-cam.y)})`;
  for (const b of blocks) animBlock(b, t);
}

// ---------- QA read-back ----------
function boxes(): TextBox[] {
  const out: TextBox[] = [];
  const add = (section: string, unit: number, text: string, r: DOMRect) => {
    if (r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) return; // off screen
    out.push({ section, unit, text: text.normalize('NFC'), x: r.x, y: r.y, w: r.width, h: r.height });
  };
  for (const b of blocks) {
    for (const w of b.words) {
      if (w.pin || w.m!.style.visibility !== 'visible' || w.inner!.style.opacity === '0.000') continue;
      add(w.section, w.unit, w.inner!.textContent ?? '', w.ink!.getBoundingClientRect());
    }
    for (const e of b.extras) {
      if (e.kind !== 'badge' || e.el!.style.visibility !== 'visible') continue;
      add(e.section, e.unit, e.el!.textContent ?? '', e.el!.getBoundingClientRect());
    }
  }
  return out;
}

// ---------- cache fingerprint ----------
function describe(b: Block) {
  return {
    i: b.i, id: b.sec.id, role: b.sec.role, x: b.x, y: b.y, rot: b.rot, s: b.s, drift: b.drift, end: b.end,
    h: b.h, hw: b.hw, hh: b.hh, top: b.top, bottom: b.bottom, first: b.first, last: b.last,
    words: b.words.map((w) => ({
      text: w.text, unit: w.unit, pin: w.pin, wt: w.wt, color: w.color, anim: w.anim, at: w.at, ltr: w.ltr,
      size: w.size, x0: w.x0, base: w.base, inkW: w.inkW, swipe: w.swipe,
    })),
    rules: b.rules.map((r) => ({ x0: r.x0, x1: r.x1, y: r.y, at: r.at, from: r.from })),
    extras: b.extras.map((e) => ({ ...e, el: undefined })),
  };
}
function fingerprint(t0: number, t1: number) {
  // Keys whose hold overlaps the window, and both keys of every move that does.
  const active = new Set<number>();
  const overlaps = (a: number, b: number) => a < t1 && b >= t0;
  keys.forEach((k, i) => {
    const holdEnd = i === keys.length - 1 ? Infinity : k.leave;
    if (overlaps(i === 0 ? -Infinity : k.arrive, holdEnd)) active.add(i);
    if (i > 0 && overlaps(keys[i - 1]!.leave, k.arrive)) active.add(i).add(i - 1);
  });
  // The blocks of the active keys and their neighbours.
  const shown = new Set<number>();
  for (const i of active) {
    const b = keys[i]!.block;
    for (const j of [b - 1, b, b + 1]) if (j >= 0 && j < blocks.length) shown.add(j);
  }
  // Anything inside the view rectangle at any (sub-)frame of the window.
  const step = 1 / (REEL.cues.fps * 4);
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const c = camera(t);
    const corners = [[-CX, -CY], [W - CX, -CY], [-CX, H - CY], [W - CX, H - CY]].map(([sx, sy]) => {
      const a = (c.r * Math.PI) / 180;
      const vx = sx! / c.s, vy = sy! / c.s;
      return [c.x + vx * Math.cos(a) - vy * Math.sin(a), c.y + vx * Math.sin(a) + vy * Math.cos(a)] as const;
    });
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const view = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    for (const b of blocks) {
      const e = aabb(b);
      if (b.x + e.hx + 40 > view.x0 && b.x - e.hx - 40 < view.x1 && b.y + e.hy + 40 > view.y0 && b.y - e.hy - 40 < view.y1) shown.add(b.i);
    }
  }
  return {
    style: 'kinetic-quote@1',
    format: REEL.format,
    palette: PAL,
    fonts: REEL.fonts,
    params: { drift: DRIFT, kick: KICK },
    blocks: [...shown].sort((a, b) => a - b).map((i) => describe(blocks[i]!)),
    keys: [...active].sort((a, b) => a - b).map((i) => keys[i]),
    kicks: kicks.filter((a) => a >= t0 - 1 && a <= t1),
  };
}

defineReelPage({ width: W, height: H, ready: setup, seek, boxes, fingerprint });
