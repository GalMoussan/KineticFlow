/**
 * Centred-stack layout (port of dilemma-reel `reel9.js`): each section of the layer is typeset as rows centred on
 * the safe area's centre, stacked top to bottom and sized by emphasis. Rules, all deterministic from the role and
 * the item count:
 *
 * - Text roles: emphasised words get rows of their own at full size; runs of plain words pack into rows of ≤ k words
 *   at `plain` × full size. Title and CTA words are all full size (the title's last word is the hero).
 * - k is chosen per section: the smallest k whose base size reaches 92 % of the best k (narrow formats stack one word
 *   per row, wide ones pair words up).
 * - datetime: weekday (small) · date (full) · time (¾); location: neon pin · place · city (small); list: title
 *   (small) + one row per item; stat/countdown: the number at 1.5× over its label; endcard: title words + logo badge.
 * - The base size fits the stack into the safe area (minus a margin) at the largest hold zoom, capped at
 *   `cap` × safe width / 0.88 × safe height.
 */
import { visualOrder } from '@reel/runtime';
import { defineLayout, type Metrics, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { NEON_PIN_METRICS, neonPinSVG } from '../../../lib/neon.ts';
import { blockFs, subScale, SUB_WEIGHT } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

const GAP = 0.26; // word gap inside a row, em
const PAD_X = 0.08; // unit box padding around the ink, em
const PAD_Y = 0.12;
const KEEP = 0.92; // k candidates: sizes ≥ KEEP × the best size
const WIDE = 1.3; // safe area aspect above which the largest candidate k wins (rows of words), else the smallest
// logo badge, in units of the base size
const BADGE = { logoH: 0.85, pad: 0.18, gap: 0.26, radius: 0.22 };

interface Tok {
  u: Unit;
  wt: number;
  pin: boolean;
}
type Row = { kind: 'text'; f: number; toks: Tok[] } | { kind: 'badge'; f: number; u: Unit };
/** A fixed row, or a run of tokens packed ≤ k per row. */
type Block = { kind: 'row'; row: Row } | { kind: 'pack'; f: number; toks: Tok[] };

/**
 * Packs a run into ⌈m/k⌉ rows of near-equal length (longer rows first), counting chunks: in runs of plain (smaller)
 * words, a word of ≤ 3 graphemes is glued to the next word (or to the previous one at the end of the run).
 */
function pack(toks: Tok[], k: number, f: number): Row[] {
  const chunks: Tok[][] = [];
  let glue: Tok[] = [];
  for (const t of toks) {
    glue.push(t);
    if (f >= 1 || t.u.graphemes > 3 || t.u.emphasis) {
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
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };

    const mt = (t: Tok): Metrics => (t.pin ? NEON_PIN_METRICS : host.metrics(t.u.text, t.wt, t.u.ltr));
    const tok = (u: Unit, wt = 900): Tok => ({ u, wt, pin: false });
    const row = (f: number, toks: Tok[]): Block => ({ kind: 'row', row: { kind: 'text', f, toks } });

    function blocks(s: Section): Block[] {
      const content = s.units.filter((u) => u.item >= 0);
      const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
      const plain = params.plain;
      const out: Block[] = [];
      switch (s.role) {
        case 'title':
        case 'cta': {
          const ws = of('word');
          if (s.role === 'title' && ws.length) ws.at(-1)!.tags.hero = true;
          out.push({ kind: 'pack', f: 1, toks: ws.map((u) => tok(u)) });
          break;
        }
        case 'datetime':
          for (const u of content) {
            if (u.kind === 'weekday') out.push(row(0.5, [tok(u, 700)]));
            else if (u.kind === 'date') out.push(row(1, [tok(u)]));
            else out.push(row(0.75, [tok(u)]));
          }
          break;
        case 'location': {
          const place = of('place');
          if (place.length) {
            const pin = host.deco(s, { deco: 'pin', at: Math.max(s.timing.in, place[0]!.at - 0.25), revealed: true, z: 1 });
            out.push(row(0.7, [{ u: pin, wt: 900, pin: true }]));
            out.push({ kind: 'pack', f: 0.9, toks: place.map((u) => tok(u)) });
          }
          for (const u of of('city')) out.push(row(0.5, [tok(u, 700)]));
          break;
        }
        case 'list':
          for (const u of of('list-title')) out.push(row(0.55, [tok(u, 700)]));
          for (const u of of('list-item')) out.push(row(plain, [tok(u)]));
          break;
        case 'stat':
        case 'countdown':
          for (const u of of('stat', 'countdown')) out.push(row(1.5, [tok(u)]));
          out.push({ kind: 'pack', f: 0.5, toks: of('word').map((u) => tok(u, 800)) });
          break;
        case 'endcard':
          out.push({ kind: 'pack', f: 0.75, toks: of('word').map((u) => tok(u)) });
          for (const u of of('logos')) out.push({ kind: 'row', row: { kind: 'badge', f: 1, u } });
          break;
        default: {
          let run: Tok[] = [];
          const flush = () => {
            if (run.length) out.push({ kind: 'pack', f: plain, toks: run });
            run = [];
          };
          for (const u of of('word')) {
            if (u.emphasis) {
              flush();
              out.push(row(1, [tok(u)]));
            } else run.push(tok(u));
          }
          flush();
        }
      }
      const subs = of('sub');
      if (subs.length) out.push({ kind: 'pack', f: subScale(blockFs(out)), toks: subs.map((u) => tok(u, SUB_WEIGHT)) });
      return out.filter((b) => b.kind === 'row' || b.toks.length);
    }

    /** Ink extents of a row at base size 1 (already × its f): width, ascent, descent. */
    const dims = (r: Row) => {
      if (r.kind === 'badge') return { w: badge1.w, ia: badge1.h, id: 0 };
      const ms = r.toks.map(mt);
      const w = ms.reduce((a, m) => a + m.bl + m.br, 0) + GAP * (r.toks.length - 1);
      return { w: w * r.f, ia: Math.max(...ms.map((m) => m.ia)) * r.f, id: Math.max(...ms.map((m) => m.id)) * r.f };
    };
    /** Base size (f = 1) at which `rows` fit; `hi` is the largest hold zoom. */
    const sizeOf = (rows: Row[], hi: number) => {
      const ds = rows.map(dims);
      const w = Math.max(...ds.map((d) => d.w));
      let h = 0;
      ds.forEach((d, i) => {
        h += d.ia + d.id;
        if (i) h += (params.leading * (rows[i - 1]!.f + rows[i]!.f)) / 2;
      });
      // the cap applies to the largest row's font size
      const fmax = Math.max(...rows.map((r) => (r.kind === 'text' ? r.f : 0.5)));
      return Math.min(FIT_W / w, FIT_H / h, CAP / Math.max(1, fmax)) / hi;
    };

    for (const s of layer.sections) {
      const bs = blocks(s);
      const hi = host.zoomRange(s)[1] * 1.005;
      const maxK = Math.max(1, ...bs.map((b) => (b.kind === 'pack' ? b.toks.length : 1)));
      const tries = Array.from({ length: maxK }, (_, i) => {
        const rows = bs.flatMap((b): Row[] => (b.kind === 'row' ? [b.row] : pack(b.toks, i + 1, b.f)));
        return { rows, size: sizeOf(rows, hi) };
      });
      const best = Math.max(...tries.map((x) => x.size));
      const near = tries.filter((x) => x.size >= KEEP * best);
      const { rows, size } = safe.w > WIDE * safe.h ? near.at(-1)! : near[0]!;

      const rtl = s.dir === 'rtl';
      const ds = rows.map(dims);
      let total = 0;
      ds.forEach((d, i) => {
        total += (d.ia + d.id) * size;
        if (i) total += (params.leading * size * (rows[i - 1]!.f + rows[i]!.f)) / 2;
      });
      let y = safe.cy - total / 2;
      let x0b = Infinity;
      let x1b = -Infinity;
      const y0b = y;
      rows.forEach((r, ri) => {
        if (ri) y += (params.leading * size * (rows[ri - 1]!.f + r.f)) / 2;
        const d = ds[ri]!;
        if (r.kind === 'badge') {
          const b = logoBadge(host, s, logos, badge1.w * size + 1, {
            logoH: BADGE.logoH * size,
            pad: BADGE.pad * size,
            gap: BADGE.gap * size,
            radius: BADGE.radius * size,
            fill: '#FBF3E4',
            border: '#FBF3E4',
            shadow: null,
          });
          Object.assign(r.u, {
            box: { x: safe.cx - b.w / 2, y, w: b.w, h: b.h },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            cls: 'neon-badge',
            mount: b.mount,
            mountKey: b.key,
            z: 1,
            font: { family: 'display', size, weight: 900 },
          });
          r.u.tags.line = ri;
          x0b = Math.min(x0b, safe.cx - b.w / 2);
          x1b = Math.max(x1b, safe.cx + b.w / 2);
          y += b.h;
          return;
        }
        const S = size * r.f;
        const base = y + d.ia * size;
        const width = d.w * size;
        let x = safe.cx - width / 2;
        x0b = Math.min(x0b, safe.cx - width / 2);
        x1b = Math.max(x1b, safe.cx + width / 2);
        // left to right in bidi visual order (an LTR run inside an RTL row keeps its own order)
        const order = visualOrder(r.toks.map((t) => (t.pin ? (rtl ? '\u200F' : '\u200E') : t.u.text)), s.dir);
        for (const t of order.map((i) => r.toks[i]!)) {
          const m = mt(t);
          const inkW = (m.bl + m.br) * S;
          const x0 = x;
          x += inkW + GAP * S;
          const u = t.u;
          u.tags.line = ri;
          if (t.pin) {
            Object.assign(u, {
              box: { x: x0, y: base - m.ia * S, w: inkW, h: 0.9 * S },
              textAt: { x: 0, y: 0 },
              html: neonPinSVG(S, `neon-pin-${u.id}`, host.accent(0, s), host.accent(3, s)),
              font: { family: 'display', size: S, weight: 900 },
              origin: '50% 100%',
            });
            continue;
          }
          const box = { x: x0 - PAD_X * S, y: base - m.ia * S - PAD_Y * S, w: inkW + 2 * PAD_X * S, h: (m.ia + m.id + 2 * PAD_Y) * S };
          const mid = S / 2 + ((m.fa - m.fd) * S) / 2;
          const inkBox = { x: -m.bl * S, y: -m.ia * S + mid, w: inkW, h: (m.ia + m.id) * S };
          Object.assign(u, {
            box,
            baseline: base,
            font: { family: 'display', size: S, weight: t.wt },
            textAt: { x: x0 + m.bl * S - box.x, y: base - mid - box.y },
            inkBox,
            innerOrigin: `${(inkBox.x + inkW / 2).toFixed(2)}px ${(inkBox.y + inkBox.h / 2).toFixed(2)}px`,
          });
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
