/**
 * Stat board (see meta). Per section: a card spanning the safe area (minus a margin) and hugging its rows
 * vertically, a header (accent dot + hairline), then rows built by role, fitted into the card's column and set flush
 * to its start edge. Bars are box rows: a `bar-track` stretched across the column, a `bar-fill` sized to the value's
 * share of the track (origin on the start edge, so a reveal grows it with `sx`), and `bar-cut` notches at the
 * quarters. Every decoration is `revealed`, so the section's reveal animates it (`tally` grows a fill with the
 * number it belongs to: same `at`).
 */
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { mixHex } from '../../../lib/neon.ts';
import { fitRows, packed, placeRows, row, stackHeight, tok, type Block, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.27; // word gap, em
const LABEL = 0.45; // labels (× base size)
const TEXT = 0.74; // text roles (× base size)
const INDENT = 0.8; // bullet column, em of its row
const HEAD = 0.42; // header band above the rows (× base size)
const DOT = 0.15; // header dot diameter (× base size)
const BADGE = { logoH: 0.9, pad: 0.2, gap: 0.3 }; // in base sizes

const numberOf = (text: string) => Number(text.replace(/[^\d.]/g, '')) || 0;

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const short = Math.min(safe.w, safe.h);
    const margin = 8 + 0.03 * short;
    const pad = params.pad * short;
    const room = safe.w - 2 * margin;
    const colW = room - 2 * pad;
    const colH = safe.h - 2 * margin - 2 * pad;
    const CAP = params.cap * Math.min(safe.w, 0.88 * safe.h);
    const BOLD = Math.round(params.weight);
    const BOOK = Math.round(params.book);
    const BAR = params.bar;
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    // bars compare every stat and countdown of the reel
    const values = host.sections.flatMap((s) => s.cue.items.filter((it) => it.kind === 'stat' || it.kind === 'countdown').map((it) => numberOf(it.text)));
    const maxValue = Math.max(1, ...values);

    /** Each bar's track → its fill and the fill's share. */
    const bars = new Map<Unit, { fill: Unit; frac: number }>();
    /** A bar row (track + fill + quarter cuts) whose fill shows `frac`, appearing with `at`. */
    function bar(s: Section, frac: number, at: number, color: string): Block {
      const track = host.deco(s, { deco: 'bar-track', at, revealed: true, z: -2 });
      const fill = host.deco(s, { deco: 'bar-fill', at, revealed: true, z: -1, style: { background: color } });
      const share = Math.max(0, Math.min(1, frac));
      bars.set(track, { fill, frac: share });
      return { kind: 'row', row: { kind: 'box', f: LABEL, u: track, w: 0.01, h: BAR } };
    }

    function blocks(s: Section): Block[] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (kinds: string[], wt: number): Tok[] => content.filter((u) => kinds.includes(u.kind)).map((u) => tok(u, wt));
      const words = () => content.filter((u) => u.kind === 'word').map((u) => tok(u, u.emphasis ? BOLD : BOOK));
      switch (s.role) {
        case 'title': {
          const ws = content.filter((u) => u.kind === 'word');
          if (ws.length) ws.at(-1)!.tags.hero = true;
          return [packed(1, ws.map((u) => tok(u, BOLD)))];
        }
        case 'datetime': {
          const time = content.find((u) => u.kind === 'time');
          const out = [
            ...of(['weekday'], BOOK).map((x) => row(LABEL, [x])),
            ...of(['date'], BOLD).map((x) => row(1.25, [x])),
            ...of(['time'], BOLD).map((x) => row(0.8, [x])),
          ];
          if (time) {
            const [hh, mm] = time.text.split(':').map(Number) as [number, number];
            out.push(bar(s, ((hh || 0) * 60 + (mm || 0)) / 1440, time.at, host.accent(2, s)));
          }
          return out;
        }
        case 'location':
          return [packed(TEXT, of(['place'], BOLD)), ...of(['city'], BOOK).map((x) => row(LABEL, [x]))];
        case 'list':
          return [...of(['list-title'], BOOK).map((x) => row(LABEL, [x])), ...of(['list-item'], BOLD).map((x) => row(0.66, [x], INDENT))];
        case 'stat':
        case 'countdown': {
          const out: Block[] = [];
          for (const u of content.filter((x) => x.kind === 'stat' || x.kind === 'countdown')) {
            out.push(row(1.6, [tok(u, BOLD)]));
            out.push(packed(LABEL, words()));
            out.push(bar(s, numberOf(u.text) / maxValue, u.at, host.accent(0, s)));
          }
          return out;
        }
        case 'endcard': {
          const out: Block[] = [packed(TEXT, of(['word'], BOLD))];
          for (const u of content.filter((x) => x.kind === 'logos')) {
            out.push({ kind: 'row', row: { kind: 'box', f: TEXT, u, w: badge1.w, h: badge1.h } });
          }
          return out;
        }
        default:
          return [packed(TEXT, words())];
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
        extraH: HEAD,
        // fewer, longer rows whenever they keep the size (a label on one line under its number)
        wide: true,
      });
      const h = (stackHeight(host, rows, GAP, params.leading) + HEAD) * size;
      const cardH = h + 2 * pad;
      const cardTop = safe.cy - cardH / 2;
      const cardX = safe.left + margin;
      const colLeft = cardX + pad;
      const rects = placeRows(host, rows, size, {
        left: colLeft,
        width: colW,
        top: cardTop + pad + HEAD * size,
        align: 'start',
        dir: s.dir,
        gap: GAP,
        leading: params.leading,
      });
      const { bg, text } = s.palette;
      const fill = mixHex(bg, text, 0.06);
      const firstAt = Math.min(...s.units.filter((u) => u.item >= 0 && Number.isFinite(u.at)).map((u) => u.at));
      const radius = 0.03 * short;
      host.deco(s, {
        deco: 'card',
        box: { x: cardX, y: cardTop, w: room, h: cardH },
        style: {
          background: fill,
          'border-radius': `${radius.toFixed(1)}px`,
          border: `2px solid ${mixHex(bg, text, 0.14)}`,
          'box-sizing': 'border-box',
        },
        at: s.timing.in,
        revealed: true,
        z: -4,
      });
      const d = DOT * size;
      const hy = cardTop + pad + (DOT * size) / 2;
      const dotX = rtl ? cardX + room - pad - d : colLeft;
      host.deco(s, {
        deco: 'dot',
        box: { x: dotX, y: hy - d / 2, w: d, h: d },
        style: { background: host.accent(0, s), 'border-radius': '50%' },
        at: Math.max(s.timing.in, firstAt - 0.25),
        revealed: true,
      });
      const ruleX0 = rtl ? colLeft : dotX + d + 0.5 * d;
      const ruleX1 = rtl ? dotX - 0.5 * d : colLeft + colW;
      host.deco(s, {
        deco: 'rule',
        box: { x: ruleX0, y: Math.round(hy) - 1, w: ruleX1 - ruleX0, h: 2 },
        style: { background: mixHex(bg, text, 0.22) },
        origin: rtl ? '100% 50%' : '0 50%',
        at: Math.max(s.timing.in, firstAt - 0.2),
        revealed: true,
      });

      rows.forEach((r, i) => {
        const rc = rects[i]!;
        if (r.kind === 'box' && r.u.deco === 'bar-track') {
          const th = BAR * size;
          const track = r.u;
          const { fill: fu, frac } = bars.get(track)!;
          const origin = rtl ? '100% 50%' : '0 50%';
          const round = `${(th / 2).toFixed(1)}px`;
          Object.assign(track, {
            box: { x: colLeft, y: rc.top, w: colW, h: th },
            style: { background: mixHex(fill, text, 0.12), 'border-radius': round },
            origin,
          });
          const fw = Math.max(th, frac * colW);
          Object.assign(fu, {
            box: { x: rtl ? colLeft + colW - fw : colLeft, y: rc.top, w: fw, h: th },
            style: { ...fu.style, 'border-radius': round },
            origin,
          });
          // notches at the quarters cut the bar into a gauge
          for (const q of [0.25, 0.5, 0.75]) {
            const x = rtl ? colLeft + colW * (1 - q) : colLeft + colW * q;
            host.deco(s, {
              deco: 'bar-cut',
              box: { x: Math.round(x) - 2, y: rc.top - 1, w: 4, h: th + 2 },
              style: { background: fill },
              at: track.at,
              revealed: true,
            });
          }
          return;
        }
        if (r.kind === 'box') {
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: 0.12 * size,
            fill: mixHex(fill, '#FFFFFF', 0.92),
            border: host.accent(0, s),
            shadow: null,
          });
          Object.assign(r.u, {
            box: { x: rtl ? rc.x1 - b.w : rc.x0, y: rc.top, w: b.w, h: b.h },
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
        const sq = 0.26 * S;
        const col = INDENT * S;
        const x0 = rtl ? rc.x1 - col : rc.x0;
        host.deco(s, {
          deco: 'bullet',
          box: { x: x0 + (col - sq) / 2 - 0.1 * S * (rtl ? -1 : 1), y: rc.base - 0.36 * S - sq / 2, w: sq, h: sq },
          style: { background: host.accent(i, s), 'border-radius': `${(0.05 * S).toFixed(1)}px` },
          font: { family: 'display', size: S, weight: BOLD },
          at: u.at,
          revealed: true,
        });
      });

      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = { x0: cardX, y0: cardTop, x1: cardX + room, y1: cardTop + cardH };
      s.data.layout = { size, rows: rows.length };
    }
  },
});
