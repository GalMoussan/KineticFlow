/**
 * Flush stack: each section is a stack of rows centred vertically in the safe area. Rows are built as in
 * `center-stack` (emphasised words get rows of their own, plain words pack ≤ k per row, roles get fixed rows) and
 * hug the start edge of the stack (`align` 0: the safe margin, 1: a centred block; 2 centres every row).
 *
 * Tokens sit on their pen advances (Canvas2D `measureText`) separated by `gap` em, so with a monospace face every
 * row keeps one character grid; ink overhangs are counted when fitting. Options: a prompt glyph in the start margin
 * of the first row and room after each row's end for a cursor (`tail`; terminal), an accent kicker rule above the
 * stack (editorial), the date line on one row (or weekday over date + time) when that keeps ≥ 55 % of the stacked
 * size, and one size for every row (`uniform`).
 */
import { visualOrder } from '@reel/runtime';
import { defineLayout, type Metrics, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { mixHex, rgbOf } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const PAD_X = 0.08; // unit box padding around the ink, em
const PAD_Y = 0.12;
const KEEP = 0.92; // k candidates: sizes ≥ KEEP × the best size
const WIDE = 1.3; // safe area aspect above which the largest candidate k wins (rows of words), else the smallest
const DATE_KEEP = 0.55; // a date-line variant wins when its size reaches this share of the best variant's
const BADGE = { logoH: 0.85, pad: 0.18, gap: 0.26, radius: 0.22 }; // in units of the base size
const RULE = { h: 0.075, w: 1.4, gap: 0.42 }; // kicker rule thickness, length, gap below; em of the first row

type Row = { kind: 'text'; f: number; toks: Unit[] } | { kind: 'badge'; f: number; u: Unit };
/** A fixed row, or a run of words packed ≤ k per row. */
type Block = { kind: 'row'; row: Row } | { kind: 'pack'; f: number; toks: Unit[] };
interface Dims {
  w: number;
  ia: number;
  id: number;
}

/** As `center-stack`: ⌈m/k⌉ rows of near-equal length; short plain words (≤ 3 graphemes) glue to the next one. */
function pack(toks: Unit[], k: number, f: number): Row[] {
  const chunks: Unit[][] = [];
  let glue: Unit[] = [];
  for (const u of toks) {
    glue.push(u);
    if (f >= 1 || u.graphemes > 3 || u.emphasis) {
      chunks.push(glue);
      glue = [];
    }
  }
  if (glue.length) {
    if (chunks.length) chunks.at(-1)!.push(...glue);
    else chunks.push(glue);
  }
  const n = Math.ceil(chunks.length / k);
  const base = Math.floor(chunks.length / n);
  const extra = chunks.length - base * n;
  const rows: Row[] = [];
  let i = 0;
  for (let r = 0; r < n; r++) {
    const len = base + (r < extra ? 1 : 0);
    rows.push({ kind: 'text', f, toks: chunks.slice(i, i + len).flat() });
    i += len;
  }
  return rows;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const margin = 8 + 0.03 * Math.min(safe.w, safe.h);
    const FIT_W = safe.w - 2 * margin;
    const FIT_H = safe.h - 2 * margin;
    const CAP = Math.min(params.cap * safe.w, params.cap * 0.88 * safe.h);
    const WT = Math.round(params.weight);
    const GAP = params.gap;
    const ALIGN = Math.round(params.align);
    const uniform = params.uniform >= 0.5;
    const F = (f: number) => (uniform ? 1 : f);
    const PROMPT = host.dir === 'rtl' ? '<' : '>';
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };

    // pen advances per 1 px of font size (Canvas2D, deterministic in Chromium; page-side like host.metrics)
    const g = document.createElement('canvas').getContext('2d')!;
    g.font = `${WT} 100px "${host.families.display}"`;
    g.fontKerning = 'normal';
    const advances = new Map<string, number>();
    const advance = (text: string, ltr: boolean): number => {
      const key = `${ltr}|${text}`;
      let a = advances.get(key);
      if (a === undefined) {
        g.direction = ltr ? 'ltr' : 'rtl';
        a = g.measureText(text).width / 100;
        advances.set(key, a);
      }
      return a;
    };
    const mt = (u: Unit): Metrics => host.metrics(u.text, WT, u.ltr);
    const promptAdv = advance(PROMPT, true);

    const row = (f: number, toks: Unit[]): Block => ({ kind: 'row', row: { kind: 'text', f: F(f), toks } });
    const packed = (f: number, toks: Unit[]): Block => ({ kind: 'pack', f: F(f), toks });

    /** Candidate block lists for a section, in order of preference (only the date line has several). */
    function variants(s: Section): Block[][] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
      const out: Block[] = [];
      switch (s.role) {
        case 'title':
        case 'cta': {
          const ws = of('word');
          if (s.role === 'title' && ws.length) ws.at(-1)!.tags.hero = true;
          out.push(packed(1, ws));
          break;
        }
        case 'datetime': {
          const day = of('weekday');
          const date = of('date');
          const time = of('time');
          const stacked = [...day.map((u) => row(0.5, [u])), ...date.map((u) => row(1, [u])), ...time.map((u) => row(0.75, [u]))];
          if (params.dateRow < 0.5) return [stacked];
          return [
            [row(1, [...day, ...date, ...time])],
            [...day.map((u) => row(0.6, [u])), row(1, [...date, ...time])],
            stacked,
          ];
        }
        case 'location':
          out.push(packed(0.9, of('place')));
          for (const u of of('city')) out.push(row(0.5, [u]));
          break;
        case 'list':
          for (const u of of('list-title')) out.push(row(0.55, [u]));
          for (const u of of('list-item')) out.push(row(params.plain, [u]));
          break;
        case 'stat':
        case 'countdown':
          for (const u of of('stat', 'countdown')) out.push(row(1.5, [u]));
          out.push(packed(0.5, of('word')));
          break;
        case 'endcard':
          out.push(packed(0.75, of('word')));
          for (const u of of('logos')) out.push({ kind: 'row', row: { kind: 'badge', f: 1, u } });
          break;
        default: {
          let run: Unit[] = [];
          const flush = () => {
            if (run.length) out.push(packed(params.plain, run));
            run = [];
          };
          for (const u of of('word')) {
            if (u.emphasis) {
              flush();
              out.push(row(1, [u]));
            } else run.push(u);
          }
          flush();
        }
      }
      return [out];
    }

    const nonEmpty = (bs: Block[]) => bs.filter((b) => (b.kind === 'row' ? b.row.kind === 'badge' || b.row.toks.length : b.toks.length));
    /** Visual (left-to-right) order of a row's tokens. */
    const visual = (r: Row & { kind: 'text' }, s: Section) => visualOrder(r.toks.map((u) => u.text), s.dir).map((i) => r.toks[i]!);

    /** Extents of a row at base size 1 (× its f): pen width incl. ink overhangs, ascent, descent. */
    function dims(r: Row, s: Section): Dims {
      if (r.kind === 'badge') return { w: badge1.w, ia: badge1.h, id: 0 };
      const toks = visual(r, s);
      const ms = toks.map(mt);
      const adv = toks.reduce((a, u) => a + advance(u.text, u.ltr), 0) + GAP * (toks.length - 1);
      const first = ms[0]!;
      const last = ms.at(-1)!;
      const w = adv + Math.max(0, first.bl) + Math.max(0, last.br - advance(toks.at(-1)!.text, toks.at(-1)!.ltr));
      const ia = uniform ? first.fa : Math.max(...ms.map((m) => m.ia));
      const id = uniform ? first.fd : Math.max(...ms.map((m) => m.id));
      return { w: w * r.f, ia: ia * r.f, id: id * r.f };
    }
    const firstF = (rows: Row[]) => rows.find((r) => r.kind === 'text')?.f ?? 1;
    /** Prompt column and kicker rule, at base size 1. */
    const promptW = (rows: Row[]) => (params.prompt >= 0.5 ? (promptAdv + GAP) * firstF(rows) : 0);
    const ruleH = (rows: Row[]) => (params.rule >= 0.5 ? (RULE.h + RULE.gap) * firstF(rows) : 0);

    /** Total height of `rows` at base size 1. */
    function height(rows: Row[], ds: Dims[]): number {
      let h = ruleH(rows);
      ds.forEach((d, i) => {
        h += d.ia + d.id;
        if (i) h += (params.leading * (rows[i - 1]!.f + rows[i]!.f)) / 2;
      });
      return h;
    }

    /** Base size (f = 1) at which `rows` fit; `hi` is the largest hold zoom. */
    function sizeOf(rows: Row[], s: Section, hi: number): number {
      const ds = rows.map((r) => dims(r, s));
      const w = Math.max(...ds.map((d, i) => d.w + params.tail * rows[i]!.f)) + promptW(rows);
      const fmax = Math.max(...rows.map((r) => (r.kind === 'text' ? r.f : 0.5)));
      return Math.min(FIT_W / w, FIT_H / height(rows, ds), CAP / Math.max(1, fmax)) / hi;
    }

    /** Best packing of one block list: smallest (narrow) or largest (wide formats) k near the best size. */
    function best(bs: Block[], s: Section, hi: number): { rows: Row[]; size: number } {
      const maxK = Math.max(1, ...bs.map((b) => (b.kind === 'pack' ? b.toks.length : 1)));
      const tries = Array.from({ length: maxK }, (_, i) => {
        const rows = bs.flatMap((b): Row[] => (b.kind === 'row' ? [b.row] : pack(b.toks, i + 1, b.f)));
        return { rows, size: sizeOf(rows, s, hi) };
      });
      const top = Math.max(...tries.map((x) => x.size));
      const near = tries.filter((x) => x.size >= KEEP * top);
      return safe.w > WIDE * safe.h ? near.at(-1)! : near[0]!;
    }

    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.005;
      const options = variants(s).map((bs) => best(nonEmpty(bs), s, hi));
      const top = Math.max(...options.map((o) => o.size));
      const { rows, size } = options.find((o) => o.size >= DATE_KEEP * top)!;

      const rtl = s.dir === 'rtl';
      const ds = rows.map((r) => dims(r, s));
      const f0 = firstF(rows);
      const pw = promptW(rows) * size;
      const blockW = Math.max(...ds.map((d, i) => (d.w + params.tail * rows[i]!.f) * size)) + pw;
      // the start edge of the stack: its left side in LTR sections, its right side in RTL ones
      const edge =
        ALIGN === 0 ? (rtl ? safe.left + safe.w - margin : safe.left + margin) : rtl ? safe.cx + blockW / 2 : safe.cx - blockW / 2;
      let y = safe.cy - (height(rows, ds) * size) / 2;
      const y0b = y;
      let x0b = Infinity;
      let x1b = -Infinity;
      const grow = (a: number, b: number) => {
        x0b = Math.min(x0b, a);
        x1b = Math.max(x1b, b);
      };
      const firstAt = Math.min(...s.units.filter((u) => u.item >= 0 && Number.isFinite(u.at)).map((u) => u.at));

      if (params.rule >= 0.5) {
        const S = size * f0;
        const w = RULE.w * S;
        const x = ALIGN === 2 ? safe.cx - w / 2 : rtl ? edge - w : edge;
        host.deco(s, {
          deco: 'rule',
          box: { x, y, w, h: RULE.h * S },
          style: { background: host.accent(0, s) },
          origin: rtl ? '100% 50%' : '0 50%',
          at: Math.max(s.timing.in, firstAt - 0.25),
          revealed: true,
        });
        grow(x, x + w);
        y += (RULE.h + RULE.gap) * S;
      }

      let promptDone = params.prompt < 0.5;
      rows.forEach((r, ri) => {
        if (ri) y += (params.leading * size * (rows[ri - 1]!.f + r.f)) / 2;
        const d = ds[ri]!;
        if (r.kind === 'badge') {
          const light = [s.palette.bg, s.palette.text].sort((a, b) => rgbOf(b).reduce((p, v) => p + v) - rgbOf(a).reduce((p, v) => p + v))[0]!;
          const fill = mixHex(light, '#FFFFFF', 0.6);
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: BADGE.radius * size,
            fill,
            border: host.accent(0, s),
            shadow: null,
          });
          const x = ALIGN === 2 ? safe.cx - b.w / 2 : rtl ? edge - pw - b.w : edge + pw;
          Object.assign(r.u, {
            box: { x, y, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            z: 1,
            font: { family: 'display', size, weight: WT },
          });
          r.u.tags.line = ri;
          grow(x, x + b.w);
          y += b.h;
          return;
        }
        const S = size * r.f;
        const base = y + d.ia * size;
        const width = d.w * size;
        const left = ALIGN === 2 ? safe.cx - width / 2 : rtl ? edge - pw - width : edge + pw;
        const toks = visual(r, s);
        let pen = left + Math.max(0, mt(toks[0]!).bl) * S;
        const place = (u: Unit, penLeft: number, m: Metrics) => {
          const inkW = (m.bl + m.br) * S;
          const inkLeft = penLeft - m.bl * S;
          const box = { x: inkLeft - PAD_X * S, y: base - m.ia * S - PAD_Y * S, w: inkW + 2 * PAD_X * S, h: (m.ia + m.id + 2 * PAD_Y) * S };
          const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
          const inkBox = { x: -m.bl * S, y: -m.ia * S + mid, w: inkW, h: (m.ia + m.id) * S };
          Object.assign(u, {
            box,
            baseline: base,
            font: { family: 'display', size: S, weight: WT },
            textAt: { x: penLeft - box.x, y: base - mid - box.y },
            inkBox,
            innerOrigin: `${(inkBox.x + inkW / 2).toFixed(2)}px ${(inkBox.y + inkBox.h / 2).toFixed(2)}px`,
          });
          grow(box.x, box.x + box.w);
        };
        for (const u of toks) {
          u.tags.line = ri;
          place(u, pen, mt(u));
          pen += (advance(u.text, u.ltr) + GAP) * S;
        }
        if (!promptDone) {
          promptDone = true;
          const p = host.deco(s, { deco: 'prompt', text: PROMPT, ltr: true, revealed: true, color: host.accent(0, s), at: s.timing.in });
          p.tags.line = ri;
          const a = promptAdv * S;
          const x = ALIGN === 2 ? (rtl ? left + width + GAP * S : left - pw) : rtl ? edge - a : edge;
          place(p, x, host.metrics(PROMPT, WT, true));
        }
        y = base + d.id * size;
      });
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = { x0: x0b, y0: y0b, x1: x1b, y1: y };
      s.data.layout = { size, rows: rows.length };
    }
  },
});
