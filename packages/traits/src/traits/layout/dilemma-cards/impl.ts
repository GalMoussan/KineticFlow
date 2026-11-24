/**
 * Dilemma cards (see meta). Per section: rows from `roleBlocks` (or, for the two options, emphasis rows and packed
 * plain words per side) fitted with `chooseRows` into the safe area minus the card padding at the largest hold zoom,
 * placed by `placeRows`; cards, seals, the disc and the '?' watermark are decorations around the placed ink, their
 * staging in `unit.data.layout` (`lib/dilemma.ts`).
 */
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { connectorIndex, type DilemmaUnit } from '../../../lib/dilemma.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import {
  chooseRows,
  inkRect,
  lightDark,
  placeRows,
  placeTok,
  roleBlocks,
  safeFit,
  weightOf,
  type Block,
  type RowGeom,
  type StackOpts,
  type Tok,
} from '../../../lib/rowset.ts';
import { meta } from './meta.ts';

type Box = StackOpts['fit'];
/** Text roles (options can split them) and whether their emphasis waits under '?' seals (not the answer: it flips). */
const SEALED: Partial<Record<string, boolean>> = { title: true, tagline: true, body: true, teaser: true, cta: true, heading: true, question: true, quote: true, answer: false };

const inset = (b: Box, d: number): Box => ({ x0: b.x0 + d, y0: b.y0 + d, x1: b.x1 - d, y1: b.y1 - d });
const px = (v: number) => `${v.toFixed(2)}px`;

function union(gs: RowGeom[]): Box {
  return {
    x0: Math.min(...gs.map((g) => g.x0)),
    y0: Math.min(...gs.map((g) => g.top)),
    x1: Math.max(...gs.map((g) => g.x1)),
    y1: Math.max(...gs.map((g) => g.bottom)),
  };
}

/** Emphasis words on rows of their own, runs of plain words packed smaller (center-stack's text rule). */
function textBlocks(units: Unit[], plain: number, wt: number): Block[] {
  const out: Block[] = [];
  let run: Tok[] = [];
  const flush = () => {
    if (run.length) out.push({ kind: 'pack', f: plain, toks: run });
    run = [];
  };
  for (const u of units) {
    if (u.emphasis) {
      flush();
      out.push({ kind: 'row', row: { kind: 'text', f: 1, toks: [{ u, wt }] } });
    } else run.push({ u, wt });
  }
  flush();
  return out;
}

function moveUnits(units: Unit[], dx: number, dy: number): void {
  for (const u of units) {
    u.box = { ...u.box, x: u.box.x + dx, y: u.box.y + dy };
    u.baseline += dy;
  }
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const fit = safeFit(host);
    const min = Math.min(safe.w, safe.h);
    const p = params.pad * min;
    const r = params.disc * min;
    const cap = Math.min(params.cap * safe.w, params.cap * 0.88 * safe.h);
    const wide = safe.w > 1.3 * safe.h;
    const W = weightOf(host, 900);

    for (const s of layer.sections) {
      const P = s.palette;
      const hot = host.accent(0, s);
      const fill = mixHex(P.bg, P.text, 0.075);
      const { light, dark } = lightDark(s);
      const badge = { fill: light, border: dark, shadow: null };
      const content = s.units.filter((u) => u.item >= 0);
      const hi = host.zoomRange(s)[1] * 1.005;
      const opts = (box: Box): StackOpts => ({ gap: 0.26, leading: params.leading, headroom: 0, fit: box, cap, hi, align: 'center' });
      const appear = s.window ? s.window.t0 + 0.05 : Math.max(0.1, s.timing.firstLand - 0.4);
      const radius = px(0.55 * p);
      const shadow = `0 ${px(0.5 * p)} ${px(1.8 * p)} rgba(0,0,0,0.55)`;
      const card = (box: Box, data: DilemmaUnit & { kind: 'card' }, style: Record<string, string>, html: string | null = null) => {
        const u = host.deco(s, {
          deco: 'card',
          cls: 'dl-card',
          box: { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 },
          z: data.card === 'back' ? -2 : -3,
          at: data.at,
          revealed: true,
          origin: '50% 50%',
          html,
          style: { 'border-radius': radius, 'box-shadow': shadow, ...style },
        });
        u.data.layout = data;
        return u;
      };
      const plainCard = { background: fill, border: `${px(Math.max(1.5, 0.003 * min))} solid ${rgba(P.text, 0.1)}` };
      /** A '?' filling `box` (watermark or the face-down card's print). */
      const qmark = (box: Box, k: number, color: string) => {
        const h = box.y1 - box.y0;
        return `<div class="dl-q" style="width:${px(box.x1 - box.x0)};height:${px(h)};line-height:${px(h)};font-size:${px(k * h)};color:${color}">?</div>`;
      };
      for (const u of content) u.data.layout = { kind: 'text', surface: fill } satisfies DilemmaUnit;

      const ci = s.role in SEALED ? connectorIndex(content) : -1;
      if (ci > 0) {
        // ── two options ──
        const A = content.slice(0, ci);
        const B = content.slice(ci + 1);
        const vs = content[ci]!;
        const inner = inset(fit, p * hi);
        // options are the point of the section: every word at full size
        const bA = textBlocks(A, 1, W);
        const bB = textBlocks(B, 1, W);
        const rtl = s.dir === 'rtl';
        const tries = (['row', 'col'] as const).map((arr) => {
          const Wd = inner.x1 - inner.x0;
          const Hd = inner.y1 - inner.y0;
          const halves: [Box, Box] =
            arr === 'row'
              ? [{ ...inner, x1: inner.x0 + (Wd - r) / 2 }, { ...inner, x0: inner.x1 - (Wd - r) / 2 }]
              : [{ ...inner, y1: inner.y0 + (Hd - r) / 2 }, { ...inner, y0: inner.y1 - (Hd - r) / 2 }];
          if (arr === 'row' && rtl) halves.reverse();
          const [fa, fb] = halves.map((h) => inset(h, (p + r / 2) * hi)) as [Box, Box];
          const ra = chooseRows(host, bA, opts(fa), wide);
          const rb = chooseRows(host, bB, opts(fb), wide);
          return { arr, fa, fb, ra, rb, size: Math.min(ra.size, rb.size) };
        });
        const [row, col] = tries as [(typeof tries)[0], (typeof tries)[0]];
        const pick = row.size >= 0.92 * col.size ? row : col;
        const size = pick.size;
        const gA = union(placeRows(host, s, pick.ra.rows, size, opts(pick.fa), badge));
        const gB = union(placeRows(host, s, pick.rb.rows, size, opts(pick.fb), badge));
        const isRow = pick.arr === 'row';
        const cw = Math.max(gA.x1 - gA.x0, gB.x1 - gB.x0) + 2 * p + (isRow ? r : 0);
        const ch = Math.max(gA.y1 - gA.y0, gB.y1 - gB.y0) + 2 * p + (isRow ? 0 : r);
        const cx = (inner.x0 + inner.x1) / 2;
        const cy = (inner.y0 + inner.y1) / 2;
        const gap = 0.9 * r;
        // card A on the start side (left in LTR, right in RTL) or on top
        const sA = isRow ? (rtl ? 1 : -1) : -1;
        const offA = isRow ? { x: sA * (cw + gap) / 2, y: 0 } : { x: 0, y: -(ch + gap) / 2 };
        const place = (g: Box, units: Unit[], o: { x: number; y: number }) => {
          moveUnits(units, cx + o.x - (g.x0 + g.x1) / 2, cy + o.y - (g.y0 + g.y1) / 2);
          return { x0: cx + o.x - cw / 2, y0: cy + o.y - ch / 2, x1: cx + o.x + cw / 2, y1: cy + o.y + ch / 2 };
        };
        const cardA = place(gA, A, offA);
        const cardB = place(gB, B, { x: -offA.x, y: -offA.y });
        card(cardA, { kind: 'card', card: 'a', at: appear, dx: 0, dy: 0 }, plainCard);
        card(cardB, { kind: 'card', card: 'b', at: vs.at - 0.12, dx: 2 * offA.x, dy: 2 * offA.y }, plainCard);
        // the connector, centred in its disc on the seam
        const disc = host.deco(s, {
          deco: 'disc',
          cls: 'dl-disc',
          box: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r },
          z: -1,
          at: vs.at - 0.1,
          revealed: true,
          origin: '50% 50%',
          style: { background: hot, 'border-radius': '50%', 'box-shadow': `0 0 ${px(1.2 * r)} ${rgba(hot, 0.45)}, 0 0 0 ${px(0.12 * r)} ${P.bg}` },
        });
        disc.data.layout = { kind: 'disc', at: vs.at - 0.1 } satisfies DilemmaUnit;
        const wv = weightOf(host, 800);
        const m = host.metrics(vs.text, wv, vs.ltr);
        const Sc = Math.min((1.2 * r) / (m.bl + m.br), (0.7 * r) / (m.ia + m.id), 0.7 * size);
        placeTok(vs, m, cx - ((m.bl + m.br) * Sc) / 2, cy + ((m.ia - m.id) / 2) * Sc, Sc, wv);
        vs.tags.line = 0;
        vs.data.layout = { kind: 'text', surface: hot, connector: true } satisfies DilemmaUnit;
        s.bounds = { x0: Math.min(cardA.x0, cardB.x0), y0: Math.min(cardA.y0, cardB.y0), x1: Math.max(cardA.x1, cardB.x1), y1: Math.max(cardA.y1, cardB.y1) };
        s.data.layout = { stage: 'split', size, flip: -1 };
        continue;
      }

      // ── one card ──
      const answer = s.role === 'answer';
      const blocks = roleBlocks(host, s, { plain: params.plain, wt: 900, pin: true });
      const o = opts(inset(fit, p * hi));
      const { rows, size } = chooseRows(host, blocks, o, wide);
      const g = union(placeRows(host, s, rows, size, o, badge));
      const box = { x0: g.x0 - p, y0: g.y0 - p, x1: g.x1 + p, y1: g.y1 + p };
      s.bounds = box;
      if (answer) {
        // the face-down card beats until just before the last word lands: every word appears on the flipped face
        const flip = Math.max(appear + 0.3, s.timing.lastLand - 0.3);
        for (const u of content) u.data.layout = { kind: 'text', surface: hot } satisfies DilemmaUnit;
        card(box, { kind: 'card', card: 'back', at: appear, dx: 0, dy: 0 }, plainCard, qmark(box, 0.62, hot));
        card(box, { kind: 'card', card: 'answer', at: flip, dx: 0, dy: 0 }, { background: hot, 'box-shadow': `0 0 ${px(2.4 * p)} ${rgba(hot, 0.5)}` });
        s.data.layout = { stage: 'answer', size, flip };
        continue;
      }
      card(box, { kind: 'card', card: 'main', at: appear, dx: 0, dy: 0 }, plainCard);
      if (s.role === 'question') {
        const mark = host.deco(s, {
          deco: 'mark',
          cls: 'dl-mark',
          box: { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 },
          z: -2,
          at: appear,
          revealed: true,
          origin: '50% 50%',
          html: qmark(box, 0.95, rgba(hot, 0.16)),
        });
        mark.data.layout = { kind: 'mark', at: appear } satisfies DilemmaUnit;
      }
      if (SEALED[s.role]) for (const u of content) if (u.kind === 'word' && (u.emphasis || u.tags.hero)) seal(u, s, appear);
      s.data.layout = { stage: s.role === 'question' ? 'question' : 'card', size, flip: -1 };
    }

    /** Two masked halves of one '?' seal over `u`'s ink (the right half shows the face shifted left). */
    function seal(u: Unit, s: Section, from: number): void {
      const S = u.font.size;
      const ink = inkRect(u);
      const x = ink.x0 - 0.12 * S;
      const y = ink.y0 - 0.1 * S;
      const w = ink.x1 - ink.x0 + 0.24 * S;
      const h = ink.y1 - ink.y0 + 0.2 * S;
      const face =
        `<div class="dl-seal" style="width:${px(w)};height:${px(h)};line-height:${px(h)};font-size:${px(0.8 * h)};` +
        `border-radius:${px(0.16 * S)};background:${host.accent(0, s)};color:${s.palette.bg}">?</div>`;
      for (const side of [-1, 1] as const) {
        const half = host.deco(s, {
          deco: 'seal',
          box: { x: side < 0 ? x : x + w / 2, y, w: w / 2, h },
          textAt: { x: side < 0 ? 0 : -w / 2, y: 0 },
          masked: true,
          z: 1,
          at: u.at,
          revealed: true,
          origin: side < 0 ? '100% 50%' : '0% 50%',
          html: face,
        });
        half.data.layout = { kind: 'seal', side, of: u.item, from } satisfies DilemmaUnit;
      }
    }
  },
});
