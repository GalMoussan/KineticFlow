/**
 * List stack (see meta). Per section: rows built by role and fitted like `center-stack` rows (slab padding folded
 * into the row spacing and width), then set as one centred column of equal-width slabs, text flush to the start
 * edge. Decorations per row: `slab` (z −2), and for list items an accent `tab` (z −1) with the item's numeral
 * (`num`, z 1). Every unit and decoration carries `data.layout.row`; units on accent slabs carry the ink chosen for
 * them (`data.layout.ink`, read by `material: tile-ink`). `section.data.layout.rows` drives the reveal's stacking.
 */
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { mixHex } from '../../../lib/neon.ts';
import { fitRows, packed, row, rowDims, setLine, tok, type Block, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.27; // word gap, em
const TAB_GAP = 0.32; // between the numeral tab and the item text, em
const BADGE = { logoH: 0.9, pad: 0.2, gap: 0.3 }; // in base sizes

/** One row of the stack, as the reveal needs it. */
export interface StackRow {
  /** When the row lands (its first unit). */
  at: number;
  /** Distance from the previous row's top (the first row: its own height + gap): how far a landing pushes. */
  step: number;
  /** Header rows stay put while the slabs stack under them. */
  fixed: boolean;
}
/** `section.data.layout` (fingerprinted). */
export interface StackData {
  size: number;
  rows: StackRow[];
}
/** `unit.data.layout` of every unit and decoration of the stack. */
export interface StackUnit {
  row: number;
  /** Ink on an accent slab (for `material: tile-ink`). */
  ink?: string;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const margin = 8 + 0.03 * Math.min(safe.w, safe.h);
    const FIT_W = safe.w - 2 * margin;
    const FIT_H = safe.h - 2 * margin;
    const CAP = params.cap * Math.min(safe.w, 0.88 * safe.h);
    const WT = Math.round(params.weight);
    const PAD = params.pad;
    const NUM = params.tab + TAB_GAP;
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };

    function blocks(s: Section): Block[] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]): Tok[] => content.filter((u) => kinds.includes(u.kind)).map((u) => tok(u, WT));
      // slab rows carry their horizontal padding as indent (both sides), numbered rows the tab too
      const slab = (f: number, toks: Tok[], numbered = false) => row(f, toks, 2 * PAD + (numbered ? NUM : 0));
      switch (s.role) {
        case 'title':
        case 'cta': {
          const ws = content.filter((u) => u.kind === 'word');
          if (s.role === 'title' && ws.length) ws.at(-1)!.tags.hero = true;
          return [packed(1, ws.map((u) => tok(u, WT)))];
        }
        case 'datetime':
          return [...of('weekday').map((x) => slab(0.55, [x])), ...of('date').map((x) => slab(1, [x])), ...of('time').map((x) => slab(0.75, [x]))];
        case 'location':
          return [packed(0.85, of('place')), ...of('city').map((x) => slab(0.55, [x]))];
        case 'list':
          return [...of('list-title').map((x) => row(0.55, [x])), ...of('list-item').map((x) => slab(0.75, [x], true))];
        case 'stat':
        case 'countdown':
          return [...of('stat', 'countdown').map((x) => slab(1.35, [x])), packed(0.55, of('word'))];
        case 'endcard': {
          const out: Block[] = [packed(0.8, of('word'))];
          for (const u of content.filter((x) => x.kind === 'logos')) out.push({ kind: 'row', row: { kind: 'box', f: 0.8, u, w: badge1.w, h: badge1.h } });
          return out;
        }
        default:
          return [packed(0.8, of('word'))];
      }
    }

    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const rtl = s.dir === 'rtl';
      // packs get their slab padding after packing (a pack's rows cannot carry an indent before it is split)
      const bs = blocks(s);
      const fit = fitRows(host, bs, {
        w: FIT_W / hi,
        h: FIT_H / hi,
        cap: CAP / hi,
        gap: GAP,
        leading: params.gap + 2 * PAD,
        extraH: 2 * PAD,
        wide: true,
      });
      const rows = fit.rows.map((r) => (r.kind === 'text' && !r.indent && r.toks[0]!.u.kind !== 'list-title' ? { ...r, indent: 2 * PAD } : r));
      // refit with the packs' padding counted (the size can only shrink)
      const widest = Math.max(...rows.map((r) => rowDims(host, r, GAP).w));
      const size = Math.min(fit.size, FIT_W / hi / widest);

      const kindOf = (r: (typeof rows)[number]) =>
        r.kind === 'box' ? 'badge' : r.toks[0]!.u.kind === 'list-title' ? 'header' : r.toks[0]!.u.kind === 'list-item' ? 'item' : 'slab';
      const slabW = Math.max(...rows.filter((r) => kindOf(r) === 'slab' || kindOf(r) === 'item').map((r) => rowDims(host, r, GAP).w * size), 0);
      const slabX = safe.cx - slabW / 2;
      const lead = (a: number, b: number) => ((params.gap + 2 * PAD) * size * (a + b)) / 2;
      // total height, to centre the stack
      let total = 0;
      rows.forEach((r, i) => {
        const d = rowDims(host, r, GAP);
        total += (d.ia + d.id) * size + (i ? lead(rows[i - 1]!.f, r.f) : 0);
      });
      const padTop = rows[0]!.kind === 'text' && kindOf(rows[0]!) !== 'header' ? PAD * rows[0]!.f * size : 0;
      let y = safe.cy - total / 2;
      const { bg, text } = s.palette;
      const dark = mixHex(bg, text, 0.1);
      const out: StackRow[] = [];
      let x0b = Infinity;
      let x1b = -Infinity;
      let prevTop = NaN;
      let n = 0;
      rows.forEach((r, i) => {
        if (i) y += lead(rows[i - 1]!.f, r.f);
        const d = rowDims(host, r, GAP);
        const S = size * r.f;
        const kind = kindOf(r);
        const units: Unit[] = r.kind === 'box' ? [r.u] : r.toks.map((x) => x.u);
        const at = Math.min(...units.map((u) => u.at));
        let top = y;
        let bottom = y + (d.ia + d.id) * size;
        if (r.kind === 'box') {
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: 0.1 * size,
            fill: mixHex(text, bg, 0.04),
            border: host.accent(0, s),
            shadow: null,
          });
          Object.assign(r.u, {
            box: { x: safe.cx - b.w / 2, y, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size, weight: WT },
          });
          r.u.data.layout = { row: i } satisfies StackUnit;
          x0b = Math.min(x0b, safe.cx - b.w / 2);
          x1b = Math.max(x1b, safe.cx + b.w / 2);
        } else {
          const base = y + d.ia * size;
          const lineW = rowDims(host, { ...r, indent: 0 }, GAP).w * size;
          const inset = PAD * S + (kind === 'item' ? NUM * S : 0);
          const left = kind === 'header' ? (rtl ? slabX + slabW - lineW : slabX) : rtl ? slabX + slabW - inset - lineW : slabX + inset;
          // header rows hug the stack's start edge (or centre when there is no slab to hug)
          const hx = slabW ? left : safe.cx - lineW / 2;
          setLine(host, r.toks, s.dir, kind === 'header' ? hx : left, base, S, GAP, i);
          if (kind !== 'header') {
            top = y - PAD * S;
            bottom = base + d.id * size + PAD * S;
            const accent = kind === 'slab' && (s.role === 'title' || s.role === 'cta');
            const fill = accent ? host.accent(i, s) : dark;
            for (const u of units) u.data.layout = { row: i, ...(accent ? { ink: bg } : {}) } satisfies StackUnit;
            const slab = host.deco(s, {
              deco: 'slab',
              box: { x: slabX, y: top, w: slabW, h: bottom - top },
              style: { background: fill, 'border-radius': `${(0.18 * S).toFixed(1)}px` },
              at,
              revealed: true,
              z: -2,
            });
            slab.data.layout = { row: i } satisfies StackUnit;
            if (kind === 'item') {
              n++;
              const tw = (params.tab + PAD) * S;
              const tx = rtl ? slabX + slabW - tw : slabX;
              const tab = host.deco(s, {
                deco: 'tab',
                box: { x: tx, y: top, w: tw, h: bottom - top },
                style: { background: host.accent(n - 1, s), 'border-radius': `${(0.18 * S).toFixed(1)}px` },
                at,
                revealed: true,
                z: -1,
              });
              tab.data.layout = { row: i } satisfies StackUnit;
              const label = String(n);
              const Sn = (bottom - top) * 0.78;
              const m = host.metrics(label, WT, true);
              const num = host.deco(s, { deco: 'num', text: label, ltr: true, color: bg, at, revealed: true, z: 1 });
              num.data.layout = { row: i } satisfies StackUnit;
              setLine(host, [tok(num, WT)], 'ltr', tx + tw / 2 - ((m.bl + m.br) * Sn) / 2, (top + bottom) / 2 + ((m.ia - m.id) * Sn) / 2, Sn, GAP, i);
            }
            x0b = Math.min(x0b, slabX);
            x1b = Math.max(x1b, slabX + slabW);
          } else {
            for (const u of units) u.data.layout = { row: i } satisfies StackUnit;
            x0b = Math.min(x0b, hx);
            x1b = Math.max(x1b, hx + lineW);
          }
        }
        out.push({ at, step: Number.isNaN(prevTop) ? bottom - top + params.gap * S : top - prevTop, fixed: kind === 'header' });
        if (kind !== 'header') prevTop = top;
        y = r.kind === 'box' ? y + d.ia * size : y + (d.ia + d.id) * size;
      });
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = { x0: x0b, y0: safe.cy - total / 2 - padTop, x1: x1b, y1: y + padTop };
      s.data.layout = { size, rows: out } satisfies StackData;
    }
  },
});
