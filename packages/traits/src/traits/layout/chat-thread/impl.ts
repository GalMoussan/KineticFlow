/**
 * Messenger thread (chat-bubbles signature layout). Every section becomes one or more bubbles stacked top to bottom
 * in one world (group coordinates = layer coordinates, every section placed at the origin):
 *
 * - speakers alternate per section, incoming (`in`, start side, logo avatar) first; the date is a centred `sys`
 *   chip that does not take a turn; the end card is always an incoming contact card. Outgoing ("me") bubbles hug
 *   the end side (right in LTR, left in RTL, as Hebrew messengers mirror their UI);
 * - message text is wrapped into rows of measured word units, start-aligned, each row in `visualOrder`;
 * - list: the list title and every item are separate bubbles from one speaker (a burst); stat / countdown: the
 *   number over its label; location: a map tile with a pin over place and city; end card: logo avatars over the
 *   name, a rule and two action icons;
 * - with a time in the spec, every bubble carries it as a stamp in its bottom end corner (outgoing: + read ticks);
 * - a typing indicator sits where each section's first bubble will appear; the tail and the avatar move down to
 *   the newest bubble of a speaker's run (`until`).
 *
 * The scroll keys (`ChatSection.keys`) keep the newest bubble's bottom on an anchor line just above the bottom of
 * the safe area, so a section's hold always shows its bubbles inside the safe area with earlier ones above.
 */
import { visualOrder } from '@reel/runtime';
import { defineLayout, type Metrics, type Section, type Unit } from '../../../contract.ts';
import {
  POP_LEAD, type Bubble, type BubbleKind, type ChatSection, type ChatUnit, type Part, type ScrollKey, type Side, type Typing,
} from '../../../lib/chat.ts';
import { pinSVG } from '../../../lib/deco.ts';
import { mixHex } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

// sizes in multiples of the thread's base text size F (rows: of the row's own size)
const ASC = 0.8; // first baseline below the top of the text block
const DESC = 0.28; // last baseline to the bottom of the text block
const LEAD = 0.3; // between one row's descent and the next row's ascent
const WGAP = 0.27; // word gap between ink boxes
const PAD_X = 0.52;
const PAD_Y = 0.36;
const TAIL_OUT = 0.36; // tail tip beyond the bubble edge
const AVATAR = 1.05;
const RUN_GAP = 0.16; // between bubbles of one speaker
const TURN_GAP = 0.62; // between speakers
const CHIP_GAP = 0.75; // around the date chip
const STAMP = 0.42;
const TYPE_W = 2.3;
const TYPE_H = 1.32;
const SCROLL = 0.42; // seconds per scroll
const ANCHOR = 0.3; // newest bubble's bottom above the safe-area bottom
const HEAD = 0.25; // kept free under the safe-area top

interface Word {
  u: Unit;
  S: number;
  wt: number;
  mt: Metrics;
  w: number;
}
interface Row {
  words: Word[];
  S: number;
  w: number;
  desc: number;
}

/** A piece of a bubble in bubble coordinates (origin: the bubble rect's top-left). */
type Piece =
  | { k: 'word'; w: Word; x0: number; base: number; line: number }
  | { k: 'stamp'; text: string; S: number; mt: Metrics; x0: number; base: number }
  | {
      k: 'deco';
      part: Part;
      x: number;
      y: number;
      w: number;
      h: number;
      z: number;
      html?: string;
      style?: Record<string, string>;
      unit?: Unit;
      mount?: (el: HTMLElement) => void;
      key?: string;
    };

interface Plan {
  kind: BubbleKind;
  side: Side;
  at: number;
  title: boolean;
  w: number;
  h: number;
  pieces: Piece[];
  first: number;
  last: number;
}

/** A block above or below a bubble's text rows (map tile, avatars, rule + icons). */
interface Block {
  minW: number;
  h: number;
  draw(pieces: Piece[], xL: number, iw: number, y: number, bw: number): void;
}

const px = (v: number) => `${v.toFixed(2)}px`;

/** Tail of a bubble whose bottom-outer corner is at (xr, yb) of a box `0.9F + TAIL_OUT·F` wide; mirrored for the left side. */
function tailSVG(F: number, th: number, right: boolean): string {
  const W = (0.9 + TAIL_OUT) * F;
  const H = th + 0.06 * F;
  const xr = 0.9 * F;
  const yb = th;
  const X = (x: number) => (right ? x : W - x).toFixed(2);
  const Y = (y: number) => y.toFixed(2);
  const d =
    `M${X(0)} ${Y(0)} L${X(xr)} ${Y(0)} L${X(xr)} ${Y(yb - 0.45 * F)} ` +
    `C${X(xr)} ${Y(yb - 0.15 * F)} ${X(xr + 0.16 * F)} ${Y(yb - 0.03 * F)} ${X(xr + TAIL_OUT * F)} ${Y(yb)} ` +
    `C${X(xr + 0.12 * F)} ${Y(yb + 0.025 * F)} ${X(xr - 0.35 * F)} ${Y(yb)} ${X(0)} ${Y(yb)} Z`;
  return (
    `<svg width="${W.toFixed(2)}" height="${H.toFixed(2)}" style="display:block;overflow:visible">` +
    `<path d="${d}" fill="rgba(0,0,0,0.10)" transform="translate(0 1.5)"/><path d="${d}" fill="currentColor"/></svg>`
  );
}

const TICKS_SVG =
  '<svg viewBox="0 0 26 15" width="100%" height="100%" style="display:block">' +
  '<path d="M1.5 8.2 L5.6 12.3 L14 2.8 M10 11 L11.4 12.3 L20 2.8" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHAT_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block"><path d="M4 4.5h16v11.5H9.5L4 20.5z" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const CALL_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block"><path d="M6.8 3.5l3 3.4-1.9 2.4a12.5 12.5 0 0 0 ' +
  '6.8 6.8l2.4-1.9 3.4 3-2 2.8C11.2 19.6 4.4 12.8 4 6z" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linejoin="round"/></svg>';

function mapSVG(w: number, h: number, c: { land: string; park: string; water: string; road: string }): string {
  return (
    `<svg width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" style="display:block">` +
    `<rect width="200" height="110" fill="${c.land}"/>` +
    `<rect x="16" y="10" width="46" height="30" rx="5" fill="${c.park}"/>` +
    `<rect x="140" y="76" width="44" height="26" rx="5" fill="${c.park}"/>` +
    `<path d="M-10 80 C40 62 82 98 130 76 S190 52 215 60" stroke="${c.water}" stroke-width="11" fill="none"/>` +
    `<path d="M0 48 H200 M0 100 H200 M76 0 V110 M158 0 V110 M24 0 L64 110 M110 0 L118 110" stroke="#FFFFFF" stroke-width="4.5" fill="none"/>` +
    `<path d="M0 66 L200 24" stroke="${c.road}" stroke-width="8" fill="none"/></svg>`
  );
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const rtl = host.dir === 'rtl';
    const sf = host.safe;
    const colW = Math.min(sf.w, sf.h * params.column);
    const colL = sf.cx - colW / 2;
    const colR = sf.cx + colW / 2;
    const logos = host.reel.logos;
    const sections = layer.sections;
    const timeText =
      host.reel.cues.sections.find((s) => s.role === 'datetime')?.items.find((it) => it.kind === 'time')?.text ?? null;

    let next: Side = 'in';
    const sideOf = new Map<Section, Side>();
    for (const s of sections) {
      if (s.role === 'datetime') sideOf.set(s, 'sys');
      else if (s.role === 'endcard') sideOf.set(s, 'in');
      else {
        sideOf.set(s, next);
        next = next === 'in' ? 'out' : 'in';
      }
    }

    // ── planning (pure geometry for a base size F; no decorations yet) ──
    function planAll(F: number): Plan[][] {
      const avM = logos.length && params.avatars ? (AVATAR + 0.28) * F : 0;
      const maxW = (colW - avM - TAIL_OUT * F) * params.width;
      const maxInner = maxW - 2 * PAD_X * F;
      const stampS = STAMP * F;
      const stampMt = timeText ? host.metrics(timeText, 400, true, 'text') : null;
      const timeW = stampMt ? (stampMt.bl + stampMt.br) * stampS : 0;
      const ticksW = 1.3 * stampS;
      const stampW = (side: Side) => timeW + (side === 'out' ? 0.18 * F + ticksW : 0);

      const word = (u: Unit, S: number, wt: number): Word => {
        const mt = host.metrics(u.text, wt, u.ltr);
        return { u, S, wt, mt, w: (mt.bl + mt.br) * S };
      };
      /** Greedy rows; a word wider than the row shrinks to fit alone. */
      const wrap = (ws: Word[], maxRow: number, desc = DESC): Row[] => {
        const rows: Row[] = [];
        let cur: Word[] = [];
        let cw = 0;
        const flush = () => {
          if (cur.length) rows.push({ words: cur, S: Math.max(...cur.map((w) => w.S)), w: cw, desc });
          cur = [];
          cw = 0;
        };
        for (const w of ws) {
          if (w.w > maxRow) {
            w.S *= maxRow / w.w;
            w.w = maxRow;
          }
          const gap = cur.length ? WGAP * w.S : 0;
          if (cur.length && cw + gap + w.w > maxRow) flush();
          cw += (cur.length ? WGAP * w.S : 0) + w.w;
          cur.push(w);
        }
        flush();
        return rows;
      };
      /** Rows from y (top of the text block); start-aligned in the reel direction or centred. Returns the last baseline and the bottom. */
      const placeRows = (rows: Row[], pieces: Piece[], xL: number, iw: number, y: number, center: boolean) => {
        let base = y;
        let prevDesc = -1;
        rows.forEach((r, li) => {
          base += prevDesc < 0 ? ASC * r.S : prevDesc + LEAD * r.S + ASC * r.S;
          prevDesc = r.desc * r.S;
          let x = center ? xL + (iw - r.w) / 2 : rtl ? xL + iw - r.w : xL;
          for (const i of visualOrder(r.words.map((w) => w.u.text), host.dir)) {
            const w = r.words[i]!;
            pieces.push({ k: 'word', w, x0: x, base, line: li });
            x += w.w + WGAP * w.S;
          }
        });
        return { base, bottom: base + Math.max(0, prevDesc) };
      };

      /** Bubble = blocks above, text rows, blocks below, then the time stamp (inline after the last row when it fits). */
      const compose = (
        s: Section,
        kind: BubbleKind,
        side: Side,
        rows: Row[],
        o: { before?: Block[]; after?: Block[]; center?: boolean; minInner?: number; title?: boolean; first: number; last: number },
      ): Plan => {
        const before = o.before ?? [];
        const after = o.after ?? [];
        const sw = stampW(side);
        const lastW = rows.at(-1)?.w ?? 0;
        let iw = Math.max(o.minInner ?? 0, ...rows.map((r) => r.w), ...before.map((b) => b.minW), ...after.map((b) => b.minW));
        const inline = !!timeText && !o.center && !after.length && rows.length > 0 && lastW + 0.5 * F + sw <= maxInner;
        if (timeText) iw = Math.max(iw, inline ? lastW + 0.5 * F + sw : sw);
        iw = Math.min(iw, Math.max(maxInner, ...rows.map((r) => r.w)));
        const xL = PAD_X * F;
        const bw = iw + 2 * xL;
        const pieces: Piece[] = [];
        let y = PAD_Y * F;
        for (const b of before) {
          b.draw(pieces, xL, iw, y, bw);
          y += b.h + 0.3 * F;
        }
        let lastBase = y;
        if (rows.length) ({ base: lastBase, bottom: y } = placeRows(rows, pieces, xL, iw, y, !!o.center));
        for (const b of after) {
          y += 0.3 * F;
          b.draw(pieces, xL, iw, y, bw);
          y += b.h;
        }
        if (timeText && stampMt) {
          // after an action row (card) the stamp shares its line at the end corner; else inline or on its own line
          const base = after.length ? y - 0.12 * F : inline ? lastBase + 0.12 * F : y + 0.16 * F + 0.74 * stampS;
          y = Math.max(y, base + 0.08 * F);
          const x0 = rtl ? xL : xL + iw - sw;
          const ticksAt = rtl ? x0 : x0 + timeW + 0.18 * F;
          const timeAt = rtl && side === 'out' ? x0 + ticksW + 0.18 * F : x0;
          pieces.push({ k: 'stamp', text: timeText, S: stampS, mt: stampMt, x0: timeAt, base });
          if (side === 'out') {
            const th = 0.72 * stampS;
            pieces.push({ k: 'deco', part: 'ticks', x: ticksAt, y: base - th, w: ticksW, h: th, z: 0, html: TICKS_SVG });
          }
        }
        const items = s.units.filter((u) => u.item >= o.first && u.item <= o.last);
        const at = Math.min(...items.map((u) => u.at).filter(Number.isFinite));
        return { kind, side, at, title: !!o.title, w: bw, h: y + PAD_Y * F, pieces, first: o.first, last: o.last };
      };

      const content = (s: Section) => s.units.filter((u) => u.item >= 0);
      const range = (us: Unit[]) => ({ first: us[0]!.item, last: us.at(-1)!.item });

      function chip(s: Section): Plan {
        const us = content(s);
        let Fc = 0.74 * F;
        const sepGap = () => 0.42 * Fc;
        const dot = () => 0.17 * Fc;
        let ws = us.map((u) => word(u, Fc, u.kind === 'date' ? 700 : 500));
        const widthOf = () => ws.reduce((a, w) => a + w.w, 0) + (ws.length - 1) * (2 * sepGap() + dot()) + 1.5 * Fc;
        if (widthOf() > colW) {
          Fc *= colW / widthOf();
          ws = us.map((u) => word(u, Fc, u.kind === 'date' ? 700 : 500));
        }
        const w = widthOf();
        const h = 1.9 * Fc;
        const base = h / 2 + 0.36 * Fc;
        const pieces: Piece[] = [];
        let x = 0.75 * Fc;
        const order = visualOrder(ws.map((v) => v.u.text), host.dir);
        order.forEach((i, k) => {
          const v = ws[i]!;
          pieces.push({ k: 'word', w: v, x0: x, base, line: 0 });
          x += v.w;
          if (k < order.length - 1) {
            const d = dot();
            pieces.push({ k: 'deco', part: 'sep', x: x + sepGap(), y: base - 0.3 * Fc - d / 2, w: d, h: d, z: 0, html: '', style: { 'border-radius': '50%' } });
            x += 2 * sepGap() + d;
          }
        });
        return { kind: 'chip', side: 'sys', at: Math.min(...us.map((u) => u.at)), title: false, w, h, pieces, ...range(us) };
      }

      function card(s: Section, side: Side): Plan {
        const us = content(s);
        const name = us.filter((u) => u.kind !== 'logos');
        const logoU = us.find((u) => u.kind === 'logos');
        const rows = wrap(name.map((u) => word(u, 1.12 * F, 700)), maxInner);
        const before: Block[] = [];
        if (logoU && logos.length) {
          const d = 2.1 * F;
          const step = 0.78 * d;
          const lw = d + (logos.length - 1) * step;
          const sized = logos.map((l) => {
            const k = 0.74 * d / Math.max(l.w, l.h);
            return { url: l.url, w: l.w * k, h: l.h * k };
          });
          before.push({
            minW: lw,
            h: d,
            draw(pieces, xL, iw, y) {
              const mount = (inner: HTMLElement) => {
                for (let i = logos.length - 1; i >= 0; i--) {
                  const l = sized[i]!;
                  const left = rtl ? (logos.length - 1 - i) * step : i * step;
                  const c = host.el('div', 'chat-avatar', inner, { left: px(left), top: '0px', width: px(d), height: px(d) });
                  const img = host.images.get(l.url)!.cloneNode() as HTMLImageElement;
                  Object.assign(img.style, { width: px(l.w), height: px(l.h) });
                  c.appendChild(img);
                }
              };
              pieces.push({ k: 'deco', part: 'avatar', unit: logoU, x: xL + (iw - lw) / 2, y, w: lw, h: d, z: 1, mount, key: JSON.stringify({ sized, d, step, rtl }) });
            },
          });
        }
        const after: Block[] = [
          {
            minW: 6.5 * F,
            h: 1.05 * F,
            draw(pieces, xL, iw, y) {
              pieces.push({ k: 'deco', part: 'rule', x: xL, y, w: iw, h: Math.max(2, 0.035 * F), z: 0, html: '' });
              const ic = 0.72 * F;
              for (const [j, html] of [CHAT_ICON, CALL_ICON].entries()) {
                pieces.push({ k: 'deco', part: 'icon', x: xL + iw / 2 + (j === 0 ? -1.4 : 0.68) * F, y: y + 0.3 * F, w: ic, h: ic, z: 0, html });
              }
            },
          },
        ];
        return compose(s, 'card', side, rows, { before, after, center: true, minInner: 6.5 * F, ...range(us) });
      }

      function location(s: Section, side: Side): Plan {
        const us = content(s);
        const rows = [
          ...wrap(us.filter((u) => u.kind === 'place').map((u) => word(u, F, u.emphasis ? 700 : 600)), maxInner),
          ...wrap(us.filter((u) => u.kind === 'city').map((u) => word(u, 0.88 * F, 400)), maxInner),
        ];
        // the tile spans the bubble minus an inset at the top; fixed height, its picture cropped to the final width
        const mapMin = Math.min(maxInner, 7 * F);
        const inset = 0.16 * F;
        const tileH = 0.55 * (mapMin + 2 * (PAD_X * F - inset));
        const before: Block[] = [
          {
            minW: mapMin,
            h: tileH - (PAD_Y * F - inset),
            draw(pieces, _xL, _iw, y, bw) {
              const w = bw - 2 * inset;
              const top = y - (PAD_Y * F - inset);
              pieces.push({
                k: 'deco', part: 'map', x: inset, y: top, w, h: tileH, z: -2,
                html: mapSVG(w, tileH, {
                  land: mixHex(s.palette.bg, '#FFFFFF', 0.45),
                  park: mixHex(host.accent(4, s), '#FFFFFF', 0.4),
                  water: mixHex(host.accent(0, s), '#FFFFFF', 0.6),
                  road: mixHex(host.accent(2, s), '#FFFFFF', 0.15),
                }),
                style: { 'border-radius': px(0.9 * F - inset), overflow: 'clip' },
              });
              const P = 1.25 * F;
              pieces.push({
                k: 'deco', part: 'pin', x: inset + w / 2 - 0.36 * P, y: top + tileH / 2 + 0.25 * P - 0.864 * P, w: 0.72 * P, h: 0.9 * P, z: -1,
                html: pinSVG(P, { body: host.accent(1, s), hole: '#FFFFFF', shadow: 'rgba(0,0,0,0.22)' }),
              });
            },
          },
        ];
        return compose(s, 'msg', side, rows, { before, ...range(us) });
      }

      function numeric(s: Section, side: Side): Plan {
        const us = content(s);
        const num = us.filter((u) => u.kind === 'stat' || u.kind === 'countdown');
        for (const u of num) {
          u.tags.numeric = true;
          u.tags.hero = true;
        }
        const rows = [
          ...wrap(num.map((u) => word(u, 2.5 * F, 800)), maxInner, 0.05),
          ...wrap(us.filter((u) => u.kind === 'word').map((u) => word(u, F, u.emphasis ? 700 : 400)), maxInner),
        ];
        return compose(s, 'msg', side, rows, range(us));
      }

      return sections.map((s): Plan[] => {
        const side = sideOf.get(s)!;
        const us = content(s);
        switch (s.role) {
          case 'datetime':
            for (const u of us) u.tags.numeric = u.kind !== 'weekday';
            return [chip(s)];
          case 'endcard':
            return [card(s, side)];
          case 'location':
            return [location(s, side)];
          case 'stat':
          case 'countdown':
            return [numeric(s, side)];
          case 'list':
            return us.map((u) => {
              const title = u.kind === 'list-title';
              return compose(s, 'msg', side, wrap([word(u, F, title ? 700 : 500)], maxInner), { title, first: u.item, last: u.item });
            });
          default: {
            const title = s.role === 'title';
            const ws = us.map((u, i) => {
              if (title && i === us.length - 1) u.tags.hero = true;
              return word(u, title ? 1.25 * F : F, title || u.emphasis ? 700 : 400);
            });
            return [compose(s, 'msg', side, wrap(ws, maxInner), { title, ...range(us) })];
          }
        }
      });
    }

    // ── base size: the widest-column size, shrunk until every section fits between the head and the anchor ──
    let F = colW * params.size;
    let plans = planAll(F);
    for (let i = 0; i < 3; i++) {
      const anchor = sf.top + sf.h - ANCHOR * F;
      const avail = anchor - (sf.top + HEAD * F);
      const span = Math.max(...plans.map((ps) => ps.reduce((a, p) => a + p.h, 0) + (ps.length - 1) * RUN_GAP * F));
      if (span <= avail) break;
      F *= (avail / span) * 0.98;
      plans = planAll(F);
    }
    const anchor = sf.top + sf.h - ANCHOR * F;
    const avM = logos.length && params.avatars ? (AVATAR + 0.28) * F : 0;
    const tailOut = TAIL_OUT * F;
    /** Tail on the right edge: outgoing in LTR, incoming in RTL. */
    const tailRight = (side: Side) => (side === 'out') !== rtl;
    const xOf = (p: { side: Side; w: number }) =>
      p.side === 'sys'
        ? sf.cx - p.w / 2
        : tailRight(p.side)
          ? (p.side === 'out' ? colR : colR - avM) - tailOut - p.w
          : (p.side === 'out' ? colL : colL + avM) + tailOut;

    // ── emission ──
    const setText = (u: Unit, S: number, wt: number, mt: Metrics, x0: number, base: number, family: 'display' | 'text') => {
      const ia = mt.ia * S;
      const id = mt.id * S;
      const inkW = (mt.bl + mt.br) * S;
      const padX = 0.06 * S;
      const padY = 0.1 * S;
      const box = { x: x0 - padX, y: base - ia - padY, w: inkW + 2 * padX, h: ia + id + 2 * padY };
      const mid = S / 2 + ((mt.fa - mt.fd) * S) / 2;
      Object.assign(u, {
        box,
        baseline: base,
        font: { family, size: S, weight: wt },
        textAt: { x: x0 + mt.bl * S - box.x, y: base - mid - box.y },
        inkBox: { x: -mt.bl * S, y: -mt.ia * S + mid, w: inkW, h: ia + id },
      });
    };
    const tag = (u: Unit, d: ChatUnit) => {
      u.data.layout = d;
      return u;
    };
    const bodyStyle = (w: number, h: number, r: number, shadow: boolean): Record<string, string> => ({
      width: px(w),
      height: px(h),
      'border-radius': px(r),
      background: 'currentColor',
      ...(shadow ? { 'box-shadow': '0 1.5px 0 rgba(0,0,0,0.10)' } : {}),
    });

    interface Placed {
      s: Section;
      cs: ChatSection;
      b: Bubble;
      popStart: number;
      first: boolean;
      runUnits: ChatUnit[];
    }
    const placed: Placed[] = [];
    let y = 0;
    let prev: Side | null = null;

    sections.forEach((s, si) => {
      const cs: ChatSection = { bubbles: [], typing: null, keys: [], F };
      s.data.layout = cs;
      const keys = cs.keys;
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const grow = (x0: number, y0: number, x1: number, y1: number) => {
        box.x0 = Math.min(box.x0, x0);
        box.y0 = Math.min(box.y0, y0);
        box.x1 = Math.max(box.x1, x1);
        box.y1 = Math.max(box.y1, y1);
      };
      plans[si]!.forEach((p, bi) => {
        const gap = prev === null ? 0 : p.side === 'sys' || prev === 'sys' ? CHIP_GAP * F : p.side === prev ? RUN_GAP * F : TURN_GAP * F;
        const by = y + gap;
        const bx = xOf(p);
        y = by + p.h;
        prev = p.side;
        const right = tailRight(p.side);

        // typing indicator before the section's first bubble, where that bubble's top will be
        if (bi === 0 && p.kind !== 'chip') {
          const t1 = p.at - POP_LEAD;
          const t0 = s.window ? s.window.t0 + 0.04 : Math.max(0.12, p.at - 0.95);
          if (t1 - t0 > 0.3) {
            const tw = TYPE_W * F;
            const th = TYPE_H * F;
            const tx = xOf({ side: p.side, w: tw });
            const typing: Typing = { t0, t1, px: right ? tx + tw + tailOut : tx - tailOut, py: by + th, side: p.side };
            cs.typing = typing;
            const r = th / 2;
            tag(host.deco(s, { deco: 'chat-typing', box: { x: tx, y: by, w: tw, h: th }, html: '', innerStyle: bodyStyle(tw, th, r, true), z: -3, revealed: true }), { part: 'typing', b: -1, side: p.side });
            const tl = (0.9 + TAIL_OUT) * F;
            const tH = Math.min(0.95 * F, th - r);
            tag(
              host.deco(s, {
                deco: 'chat-typing', box: { x: right ? tx + tw - 0.9 * F : tx - tailOut, y: by + th - tH, w: tl, h: tH },
                html: tailSVG(F, tH, right), z: -3, revealed: true,
              }),
              { part: 'typing', b: -1, side: p.side },
            );
            const d = 0.26 * F;
            for (let i = 0; i < 3; i++) {
              const cx = tx + tw / 2 + (i - 1) * 0.5 * F;
              tag(
                host.deco(s, { deco: 'chat-dot', box: { x: cx - d / 2, y: by + th / 2 - d / 2, w: d, h: d }, html: '', innerStyle: bodyStyle(d, d, d / 2, false), z: -2, revealed: true }),
                { part: 'dot', b: -1, side: p.side, i },
              );
            }
            keys.push({ t: t0, d: SCROLL * 0.85, y: Math.round(by + th - anchor) });
            grow(tx - tailOut, by, tx + tw + tailOut, by + th);
          }
        }

        const pivot = p.kind === 'chip' ? [bx + p.w / 2, by + p.h / 2] : [right ? bx + p.w + tailOut : bx - tailOut, by + p.h];
        const b: Bubble = { kind: p.kind, side: p.side, at: p.at, px: pivot[0]!, py: pivot[1]!, read: null, title: p.title, first: p.first, last: p.last };
        cs.bubbles.push(b);
        const runUnits: ChatUnit[] = [];
        const r = p.kind === 'chip' ? p.h / 2 : Math.min(0.9 * F, p.h / 2);
        tag(host.deco(s, { deco: 'chat-body', box: { x: bx, y: by, w: p.w, h: p.h }, html: '', innerStyle: bodyStyle(p.w, p.h, r, true), z: -3, revealed: true }), { part: 'body', b: bi, side: p.side });
        if (p.kind !== 'chip') {
          const tH = Math.min(0.95 * F, p.h - r);
          const tail: ChatUnit = { part: 'tail', b: bi, side: p.side };
          runUnits.push(tail);
          tag(
            host.deco(s, {
              deco: 'chat-tail', box: { x: right ? bx + p.w - 0.9 * F : bx - tailOut, y: by + p.h - tH, w: (0.9 + TAIL_OUT) * F, h: tH },
              html: tailSVG(F, tH, right), z: -3, revealed: true,
            }),
            tail,
          );
          if (p.side === 'in' && avM) {
            const d = AVATAR * F;
            const l = logos[0]!;
            const k = (0.76 * d) / Math.max(l.w, l.h);
            const iw = l.w * k;
            const ih = l.h * k;
            const av: ChatUnit = { part: 'avatar', b: bi, side: p.side };
            runUnits.push(av);
            tag(
              host.deco(s, {
                deco: 'chat-avatar', box: { x: rtl ? colR - d : colL, y: by + p.h - d, w: d, h: d }, z: -1, revealed: true,
                mount: (inner) => {
                  const c = host.el('div', 'chat-avatar', inner, { left: '0px', top: '0px', width: px(d), height: px(d) });
                  const img = host.images.get(l.url)!.cloneNode() as HTMLImageElement;
                  Object.assign(img.style, { width: px(iw), height: px(ih) });
                  c.appendChild(img);
                },
                mountKey: JSON.stringify({ url: l.url, d, iw, ih }),
              }),
              av,
            );
          }
        }
        for (const q of p.pieces) {
          if (q.k === 'word') {
            setText(q.w.u, q.w.S, q.w.wt, q.w.mt, bx + q.x0, by + q.base, 'display');
            q.w.u.tags.line = q.line;
            tag(q.w.u, { part: 'text', b: bi, side: p.side });
          } else if (q.k === 'stamp') {
            const u = host.deco(s, { deco: 'chat-stamp', text: q.text, ltr: true, z: 0, revealed: true });
            setText(u, q.S, 400, q.mt, bx + q.x0, by + q.base, 'text');
            tag(u, { part: 'stamp', b: bi, side: p.side });
          } else {
            const geo = { box: { x: bx + q.x, y: by + q.y, w: q.w, h: q.h }, z: q.z };
            const inner = { width: px(q.w), height: px(q.h), ...(q.html === '' ? { background: 'currentColor' } : {}), ...q.style };
            if (q.unit) {
              Object.assign(q.unit, geo, { textAt: { x: 0, y: 0 }, innerStyle: inner, mount: q.mount ?? null, mountKey: q.key ?? '' });
              tag(q.unit, { part: q.part, b: bi, side: p.side });
            } else {
              tag(host.deco(s, { deco: `chat-${q.part}`, ...geo, html: q.html ?? '', innerStyle: inner, revealed: true }), { part: q.part, b: bi, side: p.side });
            }
          }
        }
        const popStart = p.at - POP_LEAD;
        keys.push({ t: p.kind === 'chip' ? popStart - 0.12 : popStart, d: SCROLL, y: Math.round(by + p.h - anchor) });
        placed.push({ s, cs, b, popStart, first: bi === 0, runUnits });
        grow(bx - tailOut - (p.side === 'in' ? avM : 0), by, bx + p.w + tailOut + (p.side === 'in' ? avM : 0), by + p.h);
      });
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: sf.cx, y: sf.cy + cs.keys.at(-1)!.y, r: 0, s: 1 };
      s.bounds = box;
    });

    // ── runs: the tail and avatar move to a speaker's newest bubble; outgoing ticks turn read when the other side answers ──
    placed.forEach((p, i) => {
      const n = placed[i + 1];
      if (n && n.b.side === p.b.side && p.b.side !== 'sys') for (const u of p.runUnits) u.until = n.popStart;
      if (p.b.side !== 'out') return;
      const reply = placed.slice(i + 1).find((q) => q.b.side === 'in');
      if (reply) p.b.read = reply.first && reply.cs.typing ? reply.cs.typing.t0 + 0.15 : reply.popStart;
    });
  },
});
