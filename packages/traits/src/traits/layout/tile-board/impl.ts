/**
 * Letter-tile board (see meta). Per section: blocks of items by role (flowing words, one item per row, the logo
 * tile), wrapped into rows of cells for every candidate board width; the pitch is the largest that fits the safe
 * area (÷ the zoom headroom), with an empty row between rows when that costs at most `lead` of the pitch. Rows are
 * centred on the grid, items in bidi visual order, the graphemes of an item in visual cells ('1') with one idle cell
 * ('0') between its words. Each unit's inner element sits so that its baseline is the cells' baseline; the reveal
 * moves each measured grapheme part onto the centre of its cell.
 */
import { hash, visualOrder } from '@reel/runtime';
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import type { MosaicGrid, TileRun } from '../../../lib/mosaic.ts';
import { meta } from './meta.ts';

type Block = { kind: 'flow'; us: Unit[] } | { kind: 'line'; u: Unit } | { kind: 'badge'; u: Unit };
type Row = { kind: 'text'; us: Unit[]; len: number } | { kind: 'badge'; u: Unit; cols: number } | { kind: 'blank' };

/** Logo tile: rows of cells, padding and gap between logos (× pitch). */
const BADGE = { rows: 2, pad: 0.24, gap: 0.3 };
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string) => [...segmenter.segment(s)].map((x) => x.segment);

function blocksOf(s: Section): Block[] {
  const content = s.units.filter((u) => u.item >= 0);
  const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
  const flow = (us: Unit[]): Block[] => (us.length ? [{ kind: 'flow', us }] : []);
  const lines = (us: Unit[]): Block[] => us.map((u) => ({ kind: 'line', u }));
  switch (s.role) {
    case 'datetime':
      return [...lines(of('weekday')), ...flow(of('date', 'time'))];
    case 'location':
      return [...flow(of('place')), ...lines(of('city'))];
    case 'list':
      return [...lines(of('list-title')), ...lines(of('list-item'))];
    case 'stat':
    case 'countdown':
      return [...lines(of('stat', 'countdown')), ...flow(of('word'))];
    case 'endcard':
      return [...flow(of('word')), ...of('logos').map((u): Block => ({ kind: 'badge', u }))];
    default:
      return flow(content);
  }
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe, W, H } = host;
    const WT = Math.round(params.weight);
    const logos = host.reel.logos;
    const aspect = logos.reduce((a, l) => a + l.w / l.h, 0);

    layer.sections.forEach((s, si) => {
      const dir = s.dir;
      const masks = new Map<Unit, string>();
      for (const u of s.units) {
        if (u.item < 0 || u.kind === 'logos') continue;
        const words = u.text.split(/\s+/u).filter(Boolean);
        const order = words.length > 1 ? visualOrder(words, u.ltr ? 'ltr' : dir) : [0];
        masks.set(u, order.map((i) => '1'.repeat(graphemes(words[i] ?? '').length)).join('0'));
      }
      const len = (u: Unit) => masks.get(u)!.length;
      // the logo tile's width in cells at any pitch (logos 2 rows tall less padding, shrunk to the board if needed)
      const badgeCols = Math.max(1, Math.ceil((BADGE.rows - 2 * BADGE.pad) * aspect + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad - 1e-6));
      const blocks = blocksOf(s);

      const rowsFor = (C: number, blank: boolean): Row[] | null => {
        const rows: Row[] = [];
        const push = (r: Row) => {
          if (blank && rows.length) rows.push({ kind: 'blank' });
          rows.push(r);
        };
        for (const b of blocks) {
          if (b.kind === 'badge') push({ kind: 'badge', u: b.u, cols: Math.min(badgeCols, C) });
          else if (b.kind === 'line') {
            if (len(b.u) > C) return null;
            push({ kind: 'text', us: [b.u], len: len(b.u) });
          } else {
            let cur: Unit[] = [];
            let w = 0;
            for (const u of b.us) {
              const l = len(u);
              if (l > C) return null;
              if (cur.length && w + 1 + l > C) {
                push({ kind: 'text', us: cur, len: w });
                cur = [];
                w = 0;
              }
              w += (cur.length ? 1 : 0) + l;
              cur.push(u);
            }
            if (cur.length) push({ kind: 'text', us: cur, len: w });
          }
        }
        return rows;
      };
      const widthOf = (rows: Row[]) => Math.max(1, ...rows.map((r) => (r.kind === 'text' ? r.len : r.kind === 'badge' ? r.cols : 0)));
      const heightOf = (rows: Row[]) => rows.reduce((a, r) => a + (r.kind === 'badge' ? BADGE.rows : 1), 0);

      const hi = host.zoomRange(s)[1] * 1.005;
      const FW = (safe.w - 2) / hi;
      const FH = (safe.h - 2) / hi;
      const cap = (params.cap * Math.min(safe.w, safe.h)) / hi;
      const total = [...masks.values()].reduce((a, m) => a + m.length + 1, 0) + badgeCols;
      const best = (blank: boolean) => {
        let out: { rows: Row[]; p: number } | null = null;
        for (let C = 1; C <= Math.max(1, total); C++) {
          const rows = rowsFor(C, blank);
          if (!rows) continue;
          const p = Math.min(FW / widthOf(rows), FH / heightOf(rows), cap);
          if (!out || p > out.p + 1e-9) out = { rows, p };
        }
        return out!;
      };
      const tight = best(false);
      const airy = best(true);
      const fit = airy.p >= (1 - params.lead) * tight.p ? airy : tight;
      const { rows } = fit;
      const p = Math.max(8, Math.floor(fit.p));
      const g = Math.max(2, Math.round(params.grout * p));
      const face = p - g;

      // glyph size: `font` × cell, smaller if the widest/tallest grapheme of the section would leave its tile
      const ref = host.metrics(dir === 'rtl' ? 'ש' : 'H', WT, dir !== 'rtl');
      let S = params.font * p;
      for (const u of masks.keys()) {
        for (const gr of graphemes(u.text.replace(/\s+/gu, ''))) {
          const m = host.metrics(gr, WT, u.ltr);
          const gw = m.bl + m.br;
          if (gw > 0) S = Math.min(S, (0.84 * face) / gw);
          const up = m.ia - ref.ia / 2;
          const down = m.id + ref.ia / 2;
          if (up > 0) S = Math.min(S, (0.44 * face) / up);
          if (down > 0) S = Math.min(S, (0.44 * face) / down);
        }
      }
      S = Math.round(S * 100) / 100;
      const by = p / 2 + (ref.ia * S) / 2; // baseline inside a cell

      const Cb = widthOf(rows);
      const Rb = heightOf(rows);
      const ox = Math.round(safe.cx - (Cb * p) / 2);
      const oy = Math.round(safe.cy - (Rb * p) / 2);
      const occ: number[] = [];
      const ink = s.palette.bg;
      let rr = 0;
      let line = 0;
      for (const r of rows) {
        if (r.kind === 'blank') {
          rr += 1;
          continue;
        }
        if (r.kind === 'badge') {
          const col = Math.floor((Cb - r.cols) / 2);
          const bw = r.cols * p - g;
          const bh = BADGE.rows * p - g;
          const b = logoBadge(host, s, logos, bw, {
            logoH: bh - 2 * BADGE.pad * p,
            pad: BADGE.pad * p,
            gap: BADGE.gap * p,
            fill: s.palette.text,
            border: s.palette.text,
            radius: Math.round(0.12 * p),
            shadow: null,
          });
          Object.assign(r.u, {
            box: { x: ox + col * p, y: oy + rr * p, w: r.cols * p, h: BADGE.rows * p },
            textAt: { x: g / 2, y: g / 2 },
            innerStyle: { width: `${bw}px`, height: `${bh}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size: S, weight: WT },
          });
          r.u.tags.line = line++;
          r.u.data.layout = { col, row: rr, cols: r.cols, rows: BADGE.rows, mask: '', ink } satisfies TileRun;
          for (let i = 0; i < r.cols; i++) for (let j = 0; j < BADGE.rows; j++) occ.push(col + i, rr + j);
          rr += BADGE.rows;
          continue;
        }
        const order = visualOrder(r.us.map((u) => u.text), dir).map((i) => r.us[i]!);
        let col = dir === 'rtl' ? Math.ceil((Cb - r.len) / 2) : Math.floor((Cb - r.len) / 2);
        for (const u of order) {
          const mask = masks.get(u)!;
          const n = mask.length;
          const m = host.metrics(u.text, WT, u.ltr);
          const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
          const textAt = { x: 0, y: by - mid };
          Object.assign(u, {
            box: { x: ox + col * p, y: oy + rr * p, w: n * p, h: p },
            textAt,
            inkBox: { x: g / 2 - textAt.x, y: g / 2 - textAt.y, w: n * p - g, h: face },
            baseline: oy + rr * p + by,
            font: { family: 'display', size: S, weight: WT },
          });
          u.tags.line = line;
          if (['date', 'time', 'stat', 'countdown'].includes(u.kind)) u.tags.numeric = true;
          u.data.layout = { col, row: rr, cols: n, rows: 1, mask, ink } satisfies TileRun;
          for (let i = 0; i < n; i++) if (mask[i] === '1') occ.push(col + i, rr);
          col += n + 1;
        }
        line++;
        rr += 1;
      }
      if (s.role === 'title') {
        const ws = s.units.filter((u) => u.item >= 0 && u.kind === 'word');
        if (ws.length) ws.at(-1)!.tags.hero = true;
      }

      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = { x0: ox, y0: oy, x1: ox + Cb * p, y1: oy + Rb * p };
      s.data.layout = { p, cols: Cb, rows: Rb };
      if (si) return;
      // the layer's grid (one section per layer: tile-board is not a world layout)
      const corners = [
        [0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2],
      ] as const;
      const [ix, iy] = corners[Math.floor(hash(layer.index * 5.31 + 0.7) * corners.length)]!;
      const w = s.window;
      const grid: MosaicGrid = {
        p,
        g,
        r: Math.round(0.12 * p),
        ox,
        oy,
        c0: Math.floor(-ox / p),
        c1: Math.ceil((W - ox) / p) - 1,
        r0: Math.floor(-oy / p),
        r1: Math.ceil((H - oy) / p) - 1,
        occ,
        intro: { x: ix, y: iy, t0: layer.start, dur: w ? Math.max(0.4, w.t1 - w.t0) : 0.8 },
        seed: Math.round(hash(layer.index * 1.37 + 0.11) * 1000) / 10,
      };
      layer.data.layout = grid;
    });
  },
});
