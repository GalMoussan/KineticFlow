/**
 * Info card (see meta). Per section: rows are built by role, fitted into the card's inner column (the safe area
 * minus a margin, the card padding and the stripe) and set flush to the start edge; the card hugs the rows (at
 * least `MIN_W` of the room, so short sections keep a card shape) and is centred in the safe area. Decorations:
 * `card` and `stripe` (animated here: the card fades up with the section, the stripe draws down from its top),
 * `bullet` per list item and a `pin` before the city (revealed with their row by the section's reveal).
 */
import { clamp01 } from '@reel/runtime';
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge, pinSVG } from '../../../lib/deco.ts';
import { mixHex, rgbOf } from '../../../lib/neon.ts';
import { appendSub, fitRows, packed, placeRows, row, rowDims, stackHeight, tok, type Block, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.27; // word gap, em
const LABEL = 0.55; // weekday, city, list title, stat label (× base size)
const TEXT = 0.8; // text roles (× base size)
const INDENT = 0.85; // bullet / pin column, em of its row
const STRIPE = 0.012; // stripe width (× safe short side)
const MIN_W = 0.8; // card width at least this share of the room
const BADGE = { logoH: 0.9, pad: 0.2, gap: 0.3 }; // in base sizes
const FADE = 0.35; // card fade-in (s)

/** `section.data.layout` (fingerprinted). */
interface Data {
  size: number;
  rows: number;
  /** Card fade start, stripe draw start (s). */
  in: number;
  draw: number;
}

const light = (hex: string) => rgbOf(hex).reduce((a, v) => a + v, 0) > 3 * 140;

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const short = Math.min(safe.w, safe.h);
    const margin = 8 + 0.03 * short;
    const pad = params.pad * short;
    const stripe = Math.max(4, Math.round(STRIPE * short));
    const room = safe.w - 2 * margin;
    // the stripe's lane on the start side: the stripe and a gap before the text
    const lane = stripe + 0.8 * pad;
    const colW = room - 2 * pad - lane;
    const colH = safe.h - 2 * margin - 2 * pad;
    const CAP = params.cap * Math.min(safe.w, 0.88 * safe.h);
    const BOLD = Math.round(params.weight);
    const BOOK = Math.round(params.book);
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };

    function blocks(s: Section): Block[] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (kinds: string[], wt: number): Tok[] => content.filter((u) => kinds.includes(u.kind)).map((u) => tok(u, wt));
      const words = () => content.filter((u) => u.kind === 'word').map((u) => tok(u, u.emphasis ? BOLD : BOOK));
      const subs = () => content.filter((u) => u.kind === 'sub').map((u) => tok(u, Math.min(BOOK, 500)));
      switch (s.role) {
        case 'title': {
          const ws = content.filter((u) => u.kind === 'word');
          if (ws.length) ws.at(-1)!.tags.hero = true;
          return appendSub([packed(1, ws.map((u) => tok(u, BOLD)))], subs());
        }
        case 'datetime':
          return [
            ...of(['weekday'], BOOK).map((x) => row(LABEL, [x])),
            ...of(['date'], BOLD).map((x) => row(1, [x])),
            ...of(['time'], BOLD).map((x) => row(0.7, [x])),
          ];
        case 'location':
          return [packed(TEXT, of(['place'], BOLD)), ...of(['city'], BOOK).map((x) => row(LABEL, [x], INDENT))];
        case 'list':
          return [...of(['list-title'], BOOK).map((x) => row(LABEL, [x])), ...of(['list-item'], BOLD).map((x) => row(0.72, [x], INDENT))];
        case 'stat':
        case 'countdown':
          return [...of(['stat', 'countdown'], BOLD).map((x) => row(1.5, [x])), packed(LABEL, words())];
        case 'endcard': {
          const out: Block[] = [packed(TEXT, of(['word'], BOLD))];
          for (const u of content.filter((x) => x.kind === 'logos')) {
            out.push({ kind: 'row', row: { kind: 'box', f: TEXT, u, w: badge1.w, h: badge1.h } });
          }
          return out;
        }
        default:
          return appendSub([packed(TEXT, words())], subs());
      }
    }

    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const rtl = s.dir === 'rtl';
      const { rows, size } = fitRows(host, blocks(s), {
        w: colW / hi,
        h: colH / hi,
        cap: CAP / hi,
        gap: GAP,
        leading: params.leading,
        // fewer, longer lines whenever they keep the size: reading flows, not a column of single words
        wide: true,
      });
      const h = stackHeight(host, rows, GAP, params.leading) * size;
      const cardH = h + 2 * pad;
      const cardTop = safe.cy - cardH / 2;
      const used = Math.max(...rows.map((r) => rowDims(host, r, GAP).w * size));
      const cardW = Math.max(MIN_W * room, used + 2 * pad + lane);
      const cardX = safe.cx - cardW / 2;
      const colLeft = rtl ? cardX + pad : cardX + pad + lane;
      const rects = placeRows(host, rows, size, {
        left: colLeft,
        width: cardW - 2 * pad - lane,
        top: cardTop + pad,
        align: 'start',
        dir: s.dir,
        gap: GAP,
        leading: params.leading,
      });

      const { bg, text } = s.palette;
      const lit = light(bg);
      const fill = lit ? '#FFFFFF' : mixHex(bg, text, 0.07);
      const radius = params.radius * short;
      host.deco(s, {
        deco: 'card',
        box: { x: cardX, y: cardTop, w: cardW, h: cardH },
        style: {
          background: fill,
          'border-radius': `${radius.toFixed(1)}px`,
          border: `2px solid ${mixHex(lit ? fill : bg, text, lit ? 0.1 : 0.16)}`,
          'box-sizing': 'border-box',
          'box-shadow': `0 ${(0.012 * short).toFixed(1)}px ${(0.04 * short).toFixed(1)}px ${mixHex(bg, text, lit ? 0.12 : 0)}55`,
        },
        z: -3,
      });
      const sx = rtl ? cardX + cardW - pad - stripe : cardX + pad;
      host.deco(s, {
        deco: 'stripe',
        box: { x: sx, y: cardTop + pad, w: stripe, h: cardH - 2 * pad },
        style: { background: host.accent(0, s), 'border-radius': `${(stripe / 2).toFixed(1)}px` },
        origin: '50% 0',
        z: -2,
      });

      const firstAt = Math.min(...s.units.filter((u) => u.item >= 0 && Number.isFinite(u.at)).map((u) => u.at));
      rows.forEach((r, i) => {
        const rc = rects[i]!;
        if (r.kind === 'box') {
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: 0.12 * size,
            fill,
            border: mixHex(fill, text, 0.18),
            shadow: null,
          });
          const x = rtl ? rc.x1 - b.w : rc.x0;
          Object.assign(r.u, {
            box: { x, y: rc.top, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size, weight: BOLD },
          });
          return;
        }
        if (!r.indent) return;
        const u: Unit = r.toks[0]!.u;
        const S = size * r.f;
        const col = INDENT * S;
        const mid = rc.base - 0.36 * S;
        const x0 = rtl ? rc.x1 - col : rc.x0;
        if (u.kind === 'city') {
          const ps = 0.82 * S;
          host.deco(s, {
            deco: 'pin',
            box: { x: x0 + (col - 0.72 * ps) / 2 - 0.08 * S * (rtl ? -1 : 1), y: rc.base - 0.86 * ps, w: 0.72 * ps, h: 0.9 * ps },
            html: pinSVG(ps, { body: host.accent(0, s), hole: fill, shadow: 'transparent' }),
            font: { family: 'display', size: S, weight: BOLD },
            at: u.at,
            revealed: true,
          });
        } else {
          const d = 0.26 * S;
          host.deco(s, {
            deco: 'bullet',
            box: { x: x0 + (col - d) / 2 - 0.1 * S * (rtl ? -1 : 1), y: mid - d / 2, w: d, h: d },
            style: { background: host.accent(0, s), 'border-radius': '50%' },
            font: { family: 'display', size: S, weight: BOLD },
            at: u.at,
            revealed: true,
          });
        }
      });

      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = { x0: cardX, y0: cardTop, x1: cardX + cardW, y1: cardTop + cardH };
      s.data.layout = { size, rows: rows.length, in: s.timing.in, draw: Math.max(s.timing.in, firstAt - 0.3) } satisfies Data;
    }
  },
  frame({ layer }, t) {
    for (const s of layer.sections) {
      const d = s.data.layout as Data;
      const m = s.motion;
      for (const u of s.units) {
        if (u.deco === 'card') {
          const k = clamp01((t - d.in) / FADE);
          u.ch.visible &&= k > 0;
          u.ch.opacity *= m.enter(k);
          u.ch.ty += (1 - m.enter(k)) * 0.03 * u.box.h;
        } else if (u.deco === 'stripe') {
          const k = clamp01((t - d.draw) / 0.5);
          u.ch.visible &&= k > 0;
          u.ch.sy *= m.inOut(k);
        }
      }
    }
  },
});
