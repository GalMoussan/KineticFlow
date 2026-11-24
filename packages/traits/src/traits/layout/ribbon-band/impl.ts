/**
 * Ribbon rows (see meta). Rows are set ink-tight with `lib/typeset` (centred, one size per role); each row then
 * gets a ribbon: its straight run spans the row's ink plus `pad` em, its swoops leave the frame on both sides and
 * curve away from the stack's middle (the middle row of an odd stack comes in from below and leaves upwards), so
 * ribbons of neighbouring rows fan out instead of tangling. Letters travel from the end side towards the start side
 * (the head of the train is the unit's first grapheme). Geometry depends only on the section's own rows.
 */
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import type { Pt } from '../../../lib/pathtext.ts';
import { fitRows, packed, placeRows, row, tok, type Block, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.28; // word gap, em
const BADGE = { logoH: 0.9, pad: 0.22, gap: 0.3 }; // in base sizes

/** One row's ribbon, group px. */
export interface Ribbon {
  /** Entry swoop P0…P3 (P3 starts the straight run) and exit swoop Q0…Q3 (Q0 ends it). */
  entry: [Pt, Pt, Pt, Pt];
  exit: [Pt, Pt, Pt, Pt];
  /** Band centre line y and half thickness. */
  y: number;
  half: number;
  color: string;
  /** Darker edge colour. */
  edge: string;
}

/** `section.data.layout`. */
export interface RibbonSection {
  size: number;
  rows: Ribbon[];
}

/** `unit.data.layout` of content units: ink chosen for contrast on the band, and the row. */
export interface RibbonUnit {
  ink: string;
  row: number;
}

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe, W, H } = host;
    const margin = 8 + 0.04 * Math.min(safe.w, safe.h);
    const FIT_W = safe.w - 2 * margin;
    const FIT_H = safe.h - 2 * margin;
    const CAP = params.cap * Math.min(safe.w, 0.9 * safe.h);
    const WT = Math.round(params.weight);
    const PAD = params.pad;
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    const t = (u: Unit): Tok => tok(u, u.emphasis || u.tags.hero ? WT + 200 : WT);

    function blocks(s: Section): Block[] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
      switch (s.role) {
        case 'title': {
          const ws = of('word');
          if (ws.length) ws.at(-1)!.tags.hero = true;
          return [packed(1, ws.map(t))];
        }
        case 'datetime':
          return [...of('weekday').map((u) => row(0.55, [t(u)])), ...of('date').map((u) => row(1, [t(u)])), ...of('time').map((u) => row(0.7, [t(u)]))];
        case 'location':
          return [packed(0.85, of('place').map(t)), ...of('city').map((u) => row(0.6, [t(u)]))];
        case 'list':
          return [...of('list-title').map((u) => row(0.6, [t(u)])), ...of('list-item').map((u) => row(0.72, [t(u)]))];
        case 'stat':
        case 'countdown':
          return [...of('stat', 'countdown').map((u) => row(1.3, [t(u)])), packed(0.6, of('word').map(t))];
        case 'endcard': {
          const out: Block[] = [packed(0.8, of('word').map(t))];
          for (const u of of('logos')) out.push({ kind: 'row', row: { kind: 'box', f: 0.8, u, w: badge1.w, h: badge1.h } });
          return out;
        }
        default:
          return [packed(0.85, of('word').map(t))];
      }
    }

    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const { rows, size } = fitRows(host, blocks(s), {
        w: FIT_W / hi,
        h: FIT_H / hi,
        cap: CAP / hi,
        gap: GAP,
        leading: params.leading,
        // the first and last bands reach PAD em beyond the ink
        extraH: 2 * PAD,
        wide: true,
      });
      // stack height at `size` (placeRows from y = 0; the second call overwrites the units), then centred
      const probe = placeRows(host, rows, size, { left: safe.left + margin, width: FIT_W, top: 0, align: 'center', dir: s.dir, gap: GAP, leading: params.leading });
      const stackH = probe.at(-1)!.bottom;
      const rects = placeRows(host, rows, size, {
        left: safe.left + margin,
        width: FIT_W,
        top: safe.cy - stackH / 2,
        align: 'center',
        dir: s.dir,
        gap: GAP,
        leading: params.leading,
      });
      const ltr = s.dir === 'ltr';
      const sigma = ltr ? -1 : 1; // travel direction along the straight run
      const V = params.swoop * H;
      const ribbons: Ribbon[] = rows.map((r, i) => {
        const rc = rects[i]!;
        const S = size * r.f;
        if (r.kind === 'box') {
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: 0.22 * size,
            fill: s.palette.bg,
            border: host.accent(i + s.index, s),
            shadow: null,
          });
          Object.assign(r.u, {
            box: { x: safe.cx - b.w / 2, y: rc.top, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size, weight: WT },
          });
        }
        const color = host.accent(i + s.index, s);
        const ink = contrast(color, s.palette.bg) >= contrast(color, s.palette.text) ? s.palette.bg : s.palette.text;
        if (r.kind === 'text') for (const x of r.toks) x.u.data.layout = { ink, row: i } satisfies RibbonUnit;
        else r.u.data.layout = { ink, row: i } satisfies RibbonUnit;
        const y = (rc.top + rc.bottom) / 2;
        const half = (rc.bottom - rc.top) / 2 + PAD * S;
        const x0 = rc.x0 - 1.4 * PAD * S;
        const x1 = rc.x1 + 1.4 * PAD * S;
        const middle = rows.length % 2 === 1 && i === (rows.length - 1) / 2;
        const rank = Math.min(1, Math.abs(y - safe.cy) / (safe.h / 2));
        const away = y < safe.cy ? -1 : 1;
        const clampY = (v: number) => Math.max(-0.15 * H, Math.min(1.15 * H, v));
        const vIn = middle ? V : away * V * (1 + 0.6 * rank);
        const vOut = middle ? -V : vIn;
        const m = half + 0.06 * W;
        // entry: from the end side's frame edge onto the straight run
        const xe = ltr ? x1 : x0;
        const P0 = { x: ltr ? W + m : -m, y: clampY(y + vIn) };
        const dxIn = Math.abs(P0.x - xe);
        const entry: Ribbon['entry'] = [P0, { x: P0.x + sigma * 0.35 * dxIn, y: P0.y }, { x: xe - sigma * 0.5 * dxIn, y }, { x: xe, y }];
        const xs = ltr ? x0 : x1;
        const Q3 = { x: ltr ? -m : W + m, y: clampY(y + vOut) };
        const dxOut = Math.abs(Q3.x - xs);
        const exit: Ribbon['exit'] = [{ x: xs, y }, { x: xs + sigma * 0.5 * dxOut, y }, { x: Q3.x - sigma * 0.35 * dxOut, y: Q3.y }, Q3];
        return { entry, exit, y, half, color, edge: `color-mix(in srgb, ${color} 72%, ${s.palette.text})` };
      });
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = null;
      s.data.layout = { size, rows: ribbons } satisfies RibbonSection;
    }
  },
});
