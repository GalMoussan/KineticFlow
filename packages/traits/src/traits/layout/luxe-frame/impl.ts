/**
 * Luxe frame (see meta): every section is a centred stack of rows in the middle of the safe area, kept small
 * (`cap`) and away from the sides (`space`) so most of the frame stays empty. One size per role (title 1, text
 * 0.78, labels 0.36 with tracking), numbers large and light. Hairlines (decorations `rule`, revealed by the reveal)
 * sit `RULE.gap` base sizes above and below the stack. Each content unit's `data.layout` holds its row centre and
 * final tracking for the reveal.
 */
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { appendSub, fitRows, packed, placeRows, row, stackHeight, tok, type Block, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.3; // word gap, em
const LABEL = 0.36; // label rows (× base size)
const TEXT = 0.78; // text roles (× base size)
const RULE = { w: 1.6, gap: 0.95 }; // hairline length and its distance from the stack, in base sizes
const BADGE = { logoH: 0.9, pad: 0.26, gap: 0.34 }; // in base sizes

/** `unit.data.layout` of content units (fingerprinted). */
export interface LuxeData {
  /** Row centre x (group px): letters track about it. */
  cx: number;
  /** Final tracking of the row (share of each letter's distance to `cx`). */
  track: number;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const margin = 8 + 0.04 * Math.min(safe.w, safe.h);
    const side = Math.max(margin, params.space * safe.w);
    const FIT_W = safe.w - 2 * side;
    const FIT_H = safe.h - 2 * Math.max(margin, params.space * 0.6 * safe.h);
    const CAP = params.cap * Math.min(safe.w, 0.88 * safe.h);
    const WT = Math.round(params.weight);
    const TR = params.track;
    const rules = params.rule >= 0.5;
    const thin = Math.max(1, Math.round(Math.min(host.W, host.H) / 900));
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };

    const t = (u: Unit, w = WT): Tok => tok(u, w);
    function blocks(s: Section): Block[] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind)).map((u) => t(u));
      const label = (toks: Tok[]) => (toks.length ? [row(LABEL, toks, 0, TR)] : []);
      const subs = () => content.filter((u) => u.kind === 'sub').map((u) => t(u, Math.min(WT, 500)));
      switch (s.role) {
        case 'title': {
          const ws = content.filter((u) => u.kind === 'word');
          if (ws.length) ws.at(-1)!.tags.hero = true;
          return appendSub([packed(1, ws.map((u) => t(u)))], subs());
        }
        case 'datetime':
          return [...label(of('weekday')), ...of('date').map((x) => row(1, [x])), ...of('time').map((x) => row(0.5, [x]))];
        case 'location':
          return [packed(TEXT, of('place')), ...label(of('city'))];
        case 'list':
          return [...label(of('list-title')), ...of('list-item').map((x) => row(0.62, [x]))];
        case 'stat':
        case 'countdown':
          return [...of('stat', 'countdown').map((x) => row(1.45, [x])), ...label(of('word'))];
        case 'endcard': {
          const out: Block[] = [packed(0.7, of('word'))];
          for (const u of content.filter((x) => x.kind === 'logos')) {
            out.push({ kind: 'row', row: { kind: 'box', f: 0.7, u, w: badge1.w, h: badge1.h } });
          }
          return out;
        }
        default:
          return appendSub([packed(TEXT, of('word'))], subs());
      }
    }

    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const extraH = rules ? 2 * RULE.gap : 0;
      const fit = fitRows(host, blocks(s), {
        w: FIT_W / hi,
        h: FIT_H / hi,
        cap: CAP / hi,
        gap: GAP,
        leading: params.leading,
        extraH,
        // fewer, longer rows whenever they keep the size: lines of words, not a column of single words
        wide: true,
      });
      const { rows, size } = fit;
      const h = stackHeight(host, rows, GAP, params.leading);
      const top = safe.cy - (h * size) / 2;
      const rects = placeRows(host, rows, size, {
        left: safe.left + side,
        width: FIT_W,
        top,
        align: 'center',
        dir: s.dir,
        gap: GAP,
        leading: params.leading,
      });
      rows.forEach((r, i) => {
        const rc = rects[i]!;
        if (r.kind === 'box') {
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: 0.05 * size,
            fill: s.palette.bg,
            border: host.accent(0, s),
            shadow: null,
          });
          const x = safe.cx - b.w / 2;
          Object.assign(r.u, {
            box: { x, y: rc.top, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            cls: 'luxe-badge',
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size, weight: WT },
          });
          return;
        }
        for (const x of r.toks) x.u.data.layout = { cx: rc.cx, track: r.track ?? 0 } satisfies LuxeData;
      });
      const y0 = rects[0]!.top;
      const y1 = rects.at(-1)!.bottom;
      const firstAt = Math.min(...s.units.filter((u) => u.item >= 0 && Number.isFinite(u.at)).map((u) => u.at));
      if (rules) {
        const w = RULE.w * size;
        for (const [i, y] of [y0 - RULE.gap * size, y1 + RULE.gap * size].entries()) {
          host.deco(s, {
            deco: 'rule',
            box: { x: safe.cx - w / 2, y: Math.round(y - thin / 2), w, h: thin },
            style: { background: host.accent(0, s) },
            origin: '50% 50%',
            at: Math.max(s.timing.in, firstAt - 0.2) + 0.15 * i,
            revealed: true,
            z: -1,
          });
        }
      }
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = {
        x0: Math.min(...rects.map((r) => r.x0)),
        y0: y0 - (rules ? RULE.gap * size : 0),
        x1: Math.max(...rects.map((r) => r.x1)),
        y1: y1 + (rules ? RULE.gap * size : 0),
      };
      s.data.layout = { size, rows: rows.length };
    }
  },
});
