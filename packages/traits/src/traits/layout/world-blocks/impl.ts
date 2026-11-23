/**
 * Kinetic-quote layout (port of dilemma-reel `reel11.js`): every section of the layer is typeset into a justified
 * block; blocks sit in one large world, each rotated per ROT_SEQ and continuing from the previous one in reading
 * direction, never visible during another block's hold.
 *
 * - Line breaking: every title word, an emphasised word or a word of ≥ 6 graphemes gets its own line; other words
 *   pair up (≤ 2 per line); a lone word of ≤ 2 graphemes joins its neighbour's line. A single plain word that would
 *   justify larger than `accentRatio` × the median justified size of the block's other lines becomes an aligned
 *   accent line (≤ ACCENT_SIZE), alternating start (weight 500) / end.
 * - Roles: datetime (weekday accent · date justified · time accent), location (pin + place, city), list (title
 *   accent + one line per item), stat/countdown (numeric hero line + label), logos → badge.
 * - Decorations (layout-animated): top rule + dot, bottom bar, accent rules, intro/outro quote marks, logo badge.
 *   The location pin is a decoration the reveal animates.
 */
import { clamp01, lerp, visualOrder } from '@reel/runtime';
import { defineLayout, type Metrics, type Section, type Unit } from '../../../contract.ts';
import { logoBadge, PIN_METRICS, pinSVG, quoteSVG } from '../../../lib/deco.ts';
import { meta } from './meta.ts';

// world px
const BW = 900; // block text width
const GAP_U = 0.22; // word gap in a justified line, as a fraction of the font size
const ACCENT_SIZE = 240;
const NUM_MAX = 460; // largest numeric hero line; larger ones become start-aligned with a rule
const RULE_MIN = 120; // shortest rule beside an accent line
const FIT_MARGIN = 16; // screen px kept free inside the safe area
const GRID = 72; // block distances snap to the dot-grid pitch of `background: paper-grid`
const QUOTE_OPEN = 270;
const QUOTE_CLOSE = 230;
const ROT_SEQ: { rot: number; dir: 'next' | 'down' | null }[] = [
  { rot: 0, dir: null },
  { rot: 90, dir: 'next' },
  { rot: 90, dir: 'down' },
  { rot: 0, dir: 'next' },
  { rot: -90, dir: 'next' },
  { rot: -90, dir: 'next' },
  { rot: 0, dir: 'next' },
  { rot: 0, dir: 'down' },
];

type Align = 'start' | 'end' | null;

/** A unit while it is being typeset. */
interface W {
  u: Unit;
  wt: number;
  pin: boolean;
  /** Counts as emphasis for line breaking. */
  strong: boolean;
  mt: Metrics;
  size: number;
  inkW: number;
  ia: number;
  id: number;
  base: number;
  x0: number;
  x1: number;
}

type Line =
  | { kind: 'words'; align: Align; size: number; words: W[] }
  | { kind: 'quote'; q: 'open' | 'close'; size: number; at: number }
  | { kind: 'badge'; u: Unit };

interface Block {
  s: Section;
  rot: number;
  dir: 'next' | 'down' | null;
  lines: Line[];
  /** Half extents including decorations, in block space. */
  hw: number;
  hh: number;
  scale: number;
  x: number;
  y: number;
}

/** Layout-owned decoration animations, stored in `unit.data.layout`. */
type Anim =
  | { anim: 'grow'; at: number; d: number }
  | { anim: 'dot'; at: number }
  | { anim: 'quote'; q: 'open' | 'close'; at: number }
  | { anim: 'badge'; at: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
};

const rotV = (deg: number, x: number, y: number): [number, number] => {
  const q = (((Math.round(deg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3; // block rotations are multiples of 90°
  const [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][q] as [number, number];
  return [x * c - y * s, x * s + y * c];
};
const sideways = (rot: number) => Math.abs(rot) % 180 === 90;
type Ext = { hx: number; hy: number };
const aabb = (b: Block): Ext => (sideways(b.rot) ? { hx: b.hh, hy: b.hw } : { hx: b.hw, hy: b.hh });
const hit = (ax: number, ay: number, a: Ext, bx: number, by: number, bb: Ext, m: number) =>
  Math.abs(ax - bx) < a.hx + bb.hx + m && Math.abs(ay - by) < a.hy + bb.hy + m;

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const rtl = host.dir === 'rtl';
    const { W, H } = host;
    const { cx: CX, cy: CY } = host.safe;
    const FIT_W = host.safe.w - 2 * FIT_MARGIN;
    const FIT_H = host.safe.h - 2 * FIT_MARGIN;
    const cues = host.reel.cues.cues;
    const introCue = cues.find((c) => c.type === 'intro');
    const outroCue = cues.find((c) => c.type === 'outro');

    const metricsOf = (w: W) => (w.pin ? PIN_METRICS : host.metrics(w.u.text, w.wt, w.u.ltr));
    const inkAt1 = (w: W) => {
      const m = metricsOf(w);
      return m.bl + m.br;
    };
    /** Font size at which a line of words spans exactly BW. */
    const justifiedSize = (ws: W[]) => BW / (ws.reduce((a, w) => a + inkAt1(w), 0) + (ws.length - 1) * GAP_U);
    /** Size of an aligned line (≤ cap), shrunk if it would leave no room for its rule. */
    const alignedSize = (ws: W[], cap: number) =>
      Math.min(cap, (BW - RULE_MIN - 40) / (ws.reduce((a, w) => a + inkAt1(w), 0) + (ws.length - 1) * 0.25));
    const words = (u: Unit, o: Partial<W> = {}): W => ({
      u, wt: 800, pin: false, strong: false, mt: PIN_METRICS, size: 0, inkW: 0, ia: 0, id: 0, base: 0, x0: 0, x1: 0, ...o,
    });

    /** Own line for strong or long words, otherwise pairs; then lone tiny words join a neighbour's line. */
    const pairUp = (ws: W[]): W[][] => {
      const lines: W[][] = [];
      let open: W[] | null = null;
      for (const w of ws) {
        if (w.strong || w.u.graphemes >= 6) {
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
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!;
        const tiny = l.length === 1 && !l[0]!.pin && !l[0]!.u.emphasis && l[0]!.u.graphemes <= 2;
        if (!tiny || lines.length === 1) continue;
        if (i + 1 < lines.length) lines[i + 1]!.unshift(l[0]!);
        else lines[i - 1]!.push(l[0]!);
        lines.splice(i--, 1);
      }
      return lines;
    };

    /** Justified lines, except lone plain words that would tower over the block: those become accent lines. */
    const justifyOrAccent = (groups: W[][]): Line[] => {
      const sizes = groups.map(justifiedSize);
      const candidate = groups.map((g) => g.length === 1 && !g[0]!.strong && !g[0]!.pin);
      const ref = sizes.filter((_, i) => !candidate[i]);
      const med = median(ref.length ? ref : sizes);
      let side = 0;
      return groups.map((g, i): Line => {
        if (!candidate[i] || sizes[i]! <= params.accentRatio * med) return { kind: 'words', align: null, size: 0, words: g };
        const start = side++ % 2 === 0;
        if (start) for (const w of g) w.wt = 500;
        return { kind: 'words', align: start ? 'start' : 'end', size: alignedSize(g, ACCENT_SIZE), words: g };
      });
    };

    const numericLine = (w: W): Line =>
      justifiedSize([w]) <= NUM_MAX
        ? { kind: 'words', align: null, size: 0, words: [w] }
        : { kind: 'words', align: 'start', size: alignedSize([w], NUM_MAX), words: [w] };

    /** Body words: emphasis → weight 900 and own line; title words are each their own hero line. */
    const textLines = (s: Section, items: Unit[]): Line[] => {
      const titleLike = s.role === 'title' || s.role === 'endcard';
      const ws = items.map((u) => words(u, titleLike ? { wt: 900, strong: s.role === 'title' } : {}));
      ws.forEach((w, k) => {
        if (titleLike && k === ws.length - 1) {
          w.u.tags.hero = true;
          w.strong = true;
        } else if (w.u.emphasis) Object.assign(w, { wt: 900, strong: true });
      });
      return justifyOrAccent(pairUp(ws));
    };

    function sectionLines(s: Section): Line[] {
      const lines: Line[] = [];
      if (s.index === 0 && introCue) lines.push({ kind: 'quote', q: 'open', size: QUOTE_OPEN, at: introCue.t });
      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
      switch (s.role) {
        case 'datetime':
          for (const u of content) {
            if (u.kind === 'weekday') {
              const w = words(u, { wt: 500 });
              lines.push({ kind: 'words', align: 'start', size: alignedSize([w], ACCENT_SIZE), words: [w] });
            } else if (u.kind === 'date') lines.push({ kind: 'words', align: null, size: 0, words: [words(u)] });
            else {
              const w = words(u, { wt: 400 });
              lines.push({ kind: 'words', align: 'end', size: alignedSize([w], ACCENT_SIZE), words: [w] });
            }
          }
          break;
        case 'location': {
          const place = of('place').map((u) => words(u, u.emphasis ? { wt: 900, strong: true } : {}));
          const groups: W[][] = [];
          if (place.length) {
            const p0 = place[0]!;
            const pin = host.deco(s, { deco: 'pin', at: Math.max(s.timing.in, p0.u.at - 0.3), revealed: true });
            groups.push([words(pin, { pin: true, strong: true }), p0], ...pairUp(place.slice(1)));
          }
          lines.push(...justifyOrAccent(groups));
          for (const u of of('city')) lines.push({ kind: 'words', align: null, size: 0, words: [words(u, { wt: 500, strong: true })] });
          break;
        }
        case 'list': {
          for (const u of of('list-title')) {
            const w = words(u, { wt: 500 });
            lines.push({ kind: 'words', align: 'start', size: alignedSize([w], ACCENT_SIZE), words: [w] });
          }
          lines.push(...justifyOrAccent(of('list-item').map((u) => [words(u)])));
          break;
        }
        case 'stat':
        case 'countdown':
          for (const u of of('stat', 'countdown')) lines.push(numericLine(words(u, { strong: true })));
          lines.push(...textLines(s, of('word')));
          break;
        default: {
          lines.push(...textLines(s, of('word')));
          for (const u of of('logos')) lines.push({ kind: 'badge', u });
        }
      }
      if (s.role === 'endcard' && outroCue) lines.push({ kind: 'quote', q: 'close', size: QUOTE_CLOSE, at: outroCue.t });
      return lines;
    }

    const lay = (u: Unit, data: Anim) => {
      u.data.layout = data;
    };

    // ── block layout (block space: origin at the block centre, y down) ──
    const quoteUnits = new Map<Section, Unit>();
    function layoutBlock(b: Block): void {
      const s = b.s;
      const ws: W[] = [];
      const placed: Unit[] = []; // decorations placed in line flow (their y is shifted with the words)
      let y = 0;
      const rules: { x0: number; x1: number; y: number; at: number; origin: string }[] = [];
      b.lines.forEach((ln, li) => {
        if (li) y += params.lead;
        if (ln.kind === 'quote') {
          const qw = ln.size;
          const qh = ln.size * 0.667;
          const start = ln.q === 'open';
          const x = start === rtl ? BW / 2 - qw : -BW / 2;
          const u = host.deco(s, { deco: 'quote', at: ln.at, z: 1, box: { x, y, w: qw, h: qh }, html: quoteSVG(ln.q, qw, host.accent(0, s)) });
          lay(u, { anim: 'quote', q: ln.q, at: ln.at });
          if (start) quoteUnits.set(s, u);
          placed.push(u);
          y += qh;
          return;
        }
        if (ln.kind === 'badge') {
          const badge = logoBadge(host, s, host.reel.logos, BW);
          const u = ln.u;
          Object.assign(u, {
            box: { x: -badge.w / 2, y: y + 10, w: badge.w, h: badge.h },
            innerStyle: { width: `${badge.w.toFixed(2)}px`, height: `${badge.h.toFixed(2)}px` },
            mount: badge.mount,
            mountKey: badge.key,
            revealed: false,
            z: 1,
          });
          lay(u, { anim: 'badge', at: u.at });
          placed.push(u);
          y += badge.h + 30;
          return;
        }
        const lw = ln.words;
        for (const w of lw) w.mt = metricsOf(w);
        let gap: number;
        if (ln.align) {
          for (const w of lw) w.size = ln.size;
          gap = ln.size * 0.25;
        } else {
          const k = justifiedSize(lw);
          for (const w of lw) w.size = k;
          gap = GAP_U * k;
        }
        for (const w of lw) {
          w.inkW = (w.mt.bl + w.mt.br) * w.size;
          w.ia = w.mt.ia * w.size;
          w.id = w.mt.id * w.size;
          w.u.tags.align = ln.align;
          w.u.tags.line = li;
        }
        const asc = Math.max(...lw.map((w) => w.ia));
        const desc = Math.max(...lw.map((w) => w.id));
        y += asc;
        const base = y;
        y += desc;
        const total = lw.reduce((a, w) => a + w.inkW, 0) + gap * (lw.length - 1);
        // A line hugs its start edge (right in RTL) or, end-aligned, its end edge; pieces go left to right in UAX #9
        // visual order, so a run of LTR items inside an RTL line keeps reading left to right. The pin leads its line.
        const hugsRight = (ln.align === 'end') !== rtl;
        let x = hugsRight ? BW / 2 - total : -BW / 2;
        const order = visualOrder(lw.map((w) => (w.pin ? (rtl ? '\u200F' : '\u200E') : w.u.text)), host.dir);
        for (const i of order) {
          const w = lw[i]!;
          w.base = base;
          w.x0 = x;
          w.x1 = x + w.inkW;
          x = w.x1 + gap;
        }
        ws.push(...lw);
        if (ln.align) {
          const at = Math.max(...lw.map((w) => w.u.at)) + 0.12;
          const ry = base - Math.min(...lw.map((w) => w.ia)) * 0.42;
          const tx0 = Math.min(...lw.map((w) => w.x0));
          const tx1 = Math.max(...lw.map((w) => w.x1));
          // The rule fills the free side and grows away from the text.
          rules.push(hugsRight ? { x0: -BW / 2, x1: tx0 - 40, y: ry, at, origin: '100% 50%' } : { x0: tx1 + 40, x1: BW / 2, y: ry, at, origin: '0 50%' });
        }
      });

      const h = y;
      const dy = -h / 2; // centre the block on its origin
      for (const w of ws) w.base += dy;
      for (const u of placed) u.box.y += dy;
      const ats = [...ws.map((w) => w.u.at), ...placed.map((u) => u.at)];
      const first = Math.min(...ats);
      const last = Math.max(...ws.map((w) => w.u.at), ...placed.filter((u) => u.kind === 'logos').map((u) => u.at));
      const top = dy - 52;
      const bottom = -dy + 50;
      b.hw = BW / 2 + 44;
      b.hh = h / 2 + 62;
      // Content (BW × h) must stay inside the fit box at the largest hold zoom (camera drift and rhythm kicks).
      b.scale = Math.min(FIT_W / BW, FIT_H / h) / (host.zoomRange(s)[1] * 1.005);

      // Block decorations: a thin rule above growing from the start edge, a dot at its end, a bar below at the start.
      const startOrigin = rtl ? '100% 50%' : '0 50%';
      lay(host.deco(s, { deco: 'rule', cls: 'rule', z: -3, origin: startOrigin, box: { x: -BW / 2, y: top, w: BW, h: 3 } }), {
        anim: 'grow', at: first - 0.35, d: 0.6,
      });
      lay(host.deco(s, { deco: 'dot', cls: 'dot', z: -3, box: { x: rtl ? -BW / 2 - 30 : BW / 2 + 14, y: top - 6.5, w: 16, h: 16 } }), {
        anim: 'dot', at: first,
      });
      lay(host.deco(s, { deco: 'bar', cls: 'bar', z: -3, origin: startOrigin, box: { x: rtl ? BW / 2 - 150 : -BW / 2, y: bottom, w: 150, h: 8 } }), {
        anim: 'grow', at: last + 0.2, d: 0.5,
      });
      for (const r of rules) {
        const u = host.deco(s, { deco: 'rule', cls: 'rule', z: -1, origin: r.origin, box: { x: r.x0, y: r.y + dy - 1.5, w: Math.max(0, r.x1 - r.x0), h: 3 } });
        lay(u, { anim: 'grow', at: r.at, d: 0.55 });
      }

      // Units: the mask box is the ink box padded; the text element sits so that its ink lands on the baseline.
      for (const w of ws) {
        const S = w.size;
        const padX = 0.08 * S;
        const padY = 0.12 * S;
        const box = { x: w.x0 - padX, y: w.base - w.ia - padY, w: w.inkW + 2 * padX, h: w.ia + w.id + 2 * padY };
        Object.assign(w.u, { box, baseline: w.base, font: { family: 'display', size: S, weight: w.wt } });
        if (w.pin) {
          w.u.textAt = { x: padX, y: padY + w.ia - 0.864 * S };
          w.u.html = pinSVG(S, { body: host.accent(1, s), hole: s.palette.bg, shadow: host.accent(3, s) });
          continue;
        }
        const mid = S / 2 + ((w.mt.fa - w.mt.fd) * S) / 2;
        w.u.textAt = { x: w.x0 + w.mt.bl * S - box.x, y: w.base - mid - box.y };
        w.u.inkBox = { x: -w.mt.bl * S, y: -w.mt.ia * S + mid, w: w.inkW, h: w.ia + w.id };
      }
    }

    // ── world placement: each block continues from the previous one, never visible during another's hold ──
    const blocks: Block[] = layer.sections.map((s, i) => {
      const seq = ROT_SEQ[i % ROT_SEQ.length]!;
      return { s, rot: seq.rot, dir: i === 0 ? null : (seq.dir ?? 'next'), lines: sectionLines(s), hw: 0, hh: 0, scale: 1, x: 0, y: 0 };
    });
    for (const b of blocks) layoutBlock(b);

    /** World half extents seen while holding on `b` (smallest hold zoom, frame measured from the focus point). */
    const holdView = (b: Block): Ext => {
      const sc = b.scale * host.zoomRange(b.s)[0] * 0.99;
      const ex = Math.max(CX, W - CX) / sc;
      const ey = Math.max(CY, H - CY) / sc;
      return sideways(b.rot) ? { hx: ey, hy: ex } : { hx: ex, hy: ey };
    };
    const flow = rtl ? -1 : 1; // reading direction along the block's x axis
    for (let i = 1; i < blocks.length; i++) {
      const p = blocks[i - 1]!;
      const b = blocks[i]!;
      const [ux, uy] = rotV(p.rot, b.dir === 'next' ? flow : 0, b.dir === 'down' ? 1 : 0);
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

    for (const b of blocks) {
      const e = aabb(b);
      b.s.place = { x: b.x, y: b.y, rot: b.rot };
      b.s.frame = { x: b.x, y: b.y, r: b.rot, s: b.scale };
      b.s.bounds = { x0: b.x - e.hx, y0: b.y - e.hy, x1: b.x + e.hx, y1: b.y + e.hy };
    }
    // Intro close-up: the camera starts on the opening quote mark of the first block.
    const A = blocks[0]!;
    const q = quoteUnits.get(A.s);
    if (q) {
      const [qx, qy] = rotV(A.rot, q.box.x + q.box.w / 2, q.box.y + q.box.h / 2 + 120);
      layer.intro = { x: A.x + qx, y: A.y + qy, r: A.rot, s: A.scale };
    }
  },

  frame({ layer }, t) {
    for (const s of layer.sections) {
      const m = s.motion;
      for (const u of s.units) {
        const a = u.data.layout as Anim | undefined;
        if (!a) continue;
        const c = u.ch;
        switch (a.anim) {
          case 'grow':
            c.sx *= m.enter(clamp01((t - a.at) / a.d));
            break;
          case 'dot': {
            const k = m.enter(clamp01((t - a.at) / 0.4));
            c.rot += 45;
            c.sx *= k;
            c.sy *= k;
            break;
          }
          case 'quote': {
            const st = a.q === 'open' ? a.at - 0.65 : a.at - 0.3;
            const k = clamp01((t - st) / 0.62);
            c.visible &&= t >= st;
            const sc = lerp(0.25, 1, m.bounce(k, 1.4));
            c.sx *= sc;
            c.sy *= sc;
            c.rot += lerp(a.q === 'open' ? -25 : 25, 0, m.enter(k));
            break;
          }
          case 'badge': {
            const st = a.at - 0.12;
            const k = clamp01((t - st) / 0.5);
            c.visible &&= t >= st;
            c.opacity *= clamp01(k * 3);
            c.ty += (1 - m.enter(k)) * 90;
            const sc = lerp(0.9, 1, m.bounce(k, 1.3));
            c.sx *= sc;
            c.sy *= sc;
            break;
          }
        }
      }
    }
  },
});
