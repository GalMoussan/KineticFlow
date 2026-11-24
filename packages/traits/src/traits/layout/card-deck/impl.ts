/**
 * Card-deck layout. Typesetting: rows from `lib/spatial-rows` on one card per section (a list: a title card and a
 * card per item, one column or two on wide frames); cards are at least 0.6 × as tall as wide, padded by `pad` em,
 * sized so the whole spread fits the safe area at the largest hold zoom. Every unit of a card (face, back, text,
 * logos) is mapped per frame about the card centre c by
 *   layer(g) = c + T + M·(g − c),  M = rotate(ψ) · s · L(φ),
 * L(φ) = the card plane turned by φ about its vertical axis, seen by a parallel camera `tilt`° above, pre-warped so
 * L(0) = identity; the back uses M · diag(−1, 1). T, ψ, s, φ follow the card's deal → flip → (hold) → fly-off.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineLayout } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { rgba } from '../../../lib/neon.ts';
import { apply2, chMat, composeOuter, facing, inv2, mix, mul2, orbit, ortho, originPx, planeMap, warp, type Mat2 } from '../../../lib/spatial.ts';
import { bestRows, inkDims, isWide, placeRow, sectionBlocks, type Row } from '../../../lib/spatial-rows.ts';
import { meta } from './meta.ts';

const LEAD = 0.25; // gap between rows on a card, em of the rows
const GAP = 0.3; // gap between cards, em of the base size
const BADGE = { logoH: 0.8, pad: 0.14, gap: 0.24, radius: 0.1 };
const MIN_ASPECT = 0.6;
/** Seconds at the start in which the cards make no sound (the music is still fading up). */
const QUIET = 0.6;

/** One card (`section.data.layout.cards[i]`): rect (group px), rest roll, timeline, deal/fly-off vectors. */
interface Card {
  x: number;
  y: number;
  w: number;
  h: number;
  rest: number;
  deal0: number;
  flip0: number;
  flip1: number;
  off0: number | null;
  from: [number, number, number];
  to: [number, number, number];
}
interface Placed {
  card: number;
  side: 'face' | 'back';
  surface?: string;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe, W, H } = host;
    const margin = 8 + 0.03 * Math.min(safe.w, safe.h);
    const FIT_W = safe.w - 2 * margin;
    const FIT_H = safe.h - 2 * margin;
    const CAP = params.cap * Math.min(safe.w, 1.4 * safe.h);
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    const rowDims = (r: Row) => (r.kind === 'badge' ? { ink: badge1.w, ia: badge1.h, id: 0 } : inkDims(host, r));
    /** Card size at base size 1 holding `rows`. */
    const cardOf = (rows: Row[]) => {
      const ds = rows.map(rowDims);
      const cw = Math.max(...ds.map((d) => d.ink)) + 2 * params.pad;
      const ch = ds.reduce((a, d, i) => a + d.ia + d.id + (i ? (LEAD * (rows[i - 1]!.f + rows[i]!.f)) / 2 : 0), 0) + 2 * params.pad;
      return { w: cw, h: Math.max(ch, MIN_ASPECT * cw), content: ch - 2 * params.pad };
    };
    const fmaxOf = (rows: Row[]) => Math.max(...rows.map((r) => r.f));

    for (const s of layer.sections) {
      const hi = host.zoomRange(s)[1] * 1.02;
      // list items are each a card's only row: they can be nearly full size
      const bs = sectionBlocks(s, s.role === 'list' ? 0.9 : 0.72);
      // cards: groups of rows; list items each get a card of their own
      let groups: Row[][];
      let S: number;
      let cols = 1;
      if (s.role === 'list') {
        const rows = bs.flatMap((b): Row[] => (b.kind === 'row' ? [b.row] : []));
        const title = rows.filter((r) => r.kind === 'text' && r.toks[0]!.u.kind === 'list-title');
        const items = rows.filter((r) => !title.includes(r));
        groups = [...(title.length ? [title] : []), ...items.map((r) => [r])];
        cols = isWide(host) && items.length > 1 ? 2 : 1;
        const t = title.length ? cardOf(title) : { w: 0, h: 0 };
        const cs = items.map((r) => cardOf([r]));
        const iw = Math.max(0, ...cs.map((c) => c.w));
        const ih = Math.max(0, ...cs.map((c) => c.h));
        const nr = Math.ceil(items.length / cols);
        const totW = Math.max(t.w, cols * iw + (cols - 1) * GAP);
        const totH = t.h + (title.length && items.length ? GAP : 0) + nr * ih + Math.max(0, nr - 1) * GAP;
        S = Math.min(FIT_W / totW, FIT_H / totH, CAP / fmaxOf(rows)) / hi;
      } else {
        const best = bestRows(bs, (rs) => {
          const c = cardOf(rs);
          return Math.min(FIT_W / c.w, FIT_H / c.h, CAP / fmaxOf(rs)) / hi;
        }, isWide(host));
        groups = [best.rows];
        S = best.size;
      }

      // card rects (group px): title card on top (own size), item cards in a grid of equal cells, all centred
      const sized = groups.map((g) => cardOf(g));
      const isList = s.role === 'list' && groups.length > 1;
      const hasTitle = isList && groups[0]!.some((r) => r.kind === 'text' && r.toks[0]!.u.kind === 'list-title');
      const items = isList ? sized.slice(hasTitle ? 1 : 0) : [];
      const iw = Math.max(0, ...items.map((c) => c.w)) * S;
      const ih = Math.max(0, ...items.map((c) => c.h)) * S;
      const gap = GAP * S;
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      if (isList) {
        const nr = Math.ceil(items.length / cols);
        const th = hasTitle ? sized[0]!.h * S : 0;
        const total = th + (hasTitle && items.length ? gap : 0) + nr * ih + Math.max(0, nr - 1) * gap;
        let y = safe.cy - total / 2;
        if (hasTitle) {
          rects.push({ x: safe.cx - (sized[0]!.w * S) / 2, y, w: sized[0]!.w * S, h: th });
          y += th + gap;
        }
        const rowW = cols * iw + (cols - 1) * gap;
        items.forEach((_, i) => {
          // reading order: the first column is the start side
          const c = i % cols;
          const col = s.dir === 'rtl' ? cols - 1 - c : c;
          rects.push({ x: safe.cx - rowW / 2 + col * (iw + gap), y: y + Math.floor(i / cols) * (ih + gap), w: iw, h: ih });
        });
      } else rects.push({ x: safe.cx - (sized[0]!.w * S) / 2, y: safe.cy - (sized[0]!.h * S) / 2, w: sized[0]!.w * S, h: sized[0]!.h * S });

      const paper = s.palette.bg;
      const next = s.next && s.next.layer !== s.layer && s.next.window ? s.next.window : null;
      const rtl = s.dir === 'rtl';
      const cards: Card[] = groups.map((rows, ci) => {
        const R = rects[ci]!;
        const accent = host.accent(ci + s.index, s);
        const border = Math.max(2, 0.03 * S);
        const shadow = `0 ${(0.05 * S).toFixed(1)}px ${(0.16 * S).toFixed(1)}px ${rgba('#000000', 0.45)}`;
        const radius = `${(0.12 * S).toFixed(1)}px`;
        const face = host.deco(s, {
          deco: 'card-face',
          box: { ...R },
          z: 0,
          style: {
            background: paper,
            'border-radius': radius,
            'box-shadow': `${shadow}, inset 0 0 0 ${(0.09 * S).toFixed(1)}px ${paper}, inset 0 0 0 ${(0.09 * S + border).toFixed(1)}px ${accent}`,
          },
        });
        face.data.layout = { card: ci, side: 'face' } satisfies Placed;
        const ink = mix(accent, '#000000', 0.25);
        const back = host.deco(s, {
          deco: 'card-back',
          box: { ...R },
          z: 0,
          style: {
            background: `repeating-linear-gradient(45deg, ${accent} 0 ${(0.08 * S).toFixed(1)}px, ${ink} ${(0.08 * S).toFixed(1)}px ${(0.16 * S).toFixed(1)}px)`,
            'border-radius': radius,
            'box-shadow': `${shadow}, inset 0 0 0 ${(0.07 * S).toFixed(1)}px ${paper}`,
          },
        });
        back.data.layout = { card: ci, side: 'back' } satisfies Placed;

        // rows centred on the card
        const ds = rows.map(rowDims);
        const content = cardOf(rows).content * S;
        let y = R.y + (R.h - content) / 2;
        rows.forEach((r, ri) => {
          if (ri) y += (LEAD * S * (rows[ri - 1]!.f + r.f)) / 2;
          const d = ds[ri]!;
          if (r.kind === 'badge') {
            const b = logoBadge(host, s, logos, badge1.w * S + 1, {
              logoH: BADGE.logoH * S,
              pad: BADGE.pad * S,
              gap: BADGE.gap * S,
              radius: BADGE.radius * S,
              fill: '#FFFFFF',
              border: accent,
              shadow: null,
            });
            Object.assign(r.u, {
              box: { x: R.x + R.w / 2 - b.w / 2, y, w: b.w, h: b.h },
              innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
              mount: b.mount,
              mountKey: b.key,
              z: 2,
              font: { family: 'display', size: S, weight: 800 },
            });
            r.u.tags.line = ri;
            r.u.data.layout = { card: ci, side: 'face', surface: paper } satisfies Placed;
            y += b.h;
            return;
          }
          placeRow(host, s, r, S, R.x + R.w / 2, y + d.ia * S, ri);
          for (const t of r.toks) {
            t.u.z = 2;
            t.u.data.layout = { card: ci, side: 'face', surface: paper } satisfies Placed;
          }
          y += (d.ia + d.id) * S;
        });

        const units = rows.flatMap((r) => (r.kind === 'badge' ? [r.u] : r.toks.map((t) => t.u)));
        const ats = units.map((u) => u.at).filter(Number.isFinite);
        const at = ats.length ? Math.min(...ats) : s.timing.firstLand;
        const flip1 = at - 0.08;
        const flip0 = flip1 - params.flip;
        const deal0 = flip0 - params.deal;
        const side = rtl ? 1 : -1; // the start side: +x in RTL
        const restRoll = (hash(s.index * 7 + ci * 3 + 1) - 0.5) * (isList ? 2.4 : 4);
        return {
          ...R,
          rest: restRoll,
          deal0,
          flip0,
          flip1,
          off0: next ? next.t0 + 0.05 * ci : null,
          from: [side * (0.55 * W) + (R.x + R.w / 2 - safe.cx) * 0.3, H - (R.y + R.h / 2) + R.h * 0.8, side * 38],
          to: [-side * (0.65 * W), -(R.y + R.h / 2) - R.h * 0.9, -side * 32],
        };
      });
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      s.bounds = null;
      s.data.layout = { cards };
    }
  },

  frame({ layer, params }, t) {
    const K = inv2(planeMap(ortho(orbit(0, params.tilt)), [1, 0, 0], [0, 1, 0]));
    const mirror: Mat2 = [-1, 0, 0, 1];
    for (const s of layer.sections) {
      const { cards } = s.data.layout as { cards: Card[] };
      const m = s.motion;
      const pose = cards.map((c) => {
        const kd = clamp01((t - c.deal0) / params.deal);
        const ed = m.enter(kd);
        const kf = clamp01((t - c.flip0) / params.flip);
        const phi = 180 * (1 - m.inOut(kf));
        const ko = c.off0 === null ? 0 : clamp01((t - c.off0) / params.off);
        const eo = m.exit(ko);
        const tx = c.from[0] * (1 - ed) + c.to[0] * eo;
        const ty = c.from[1] * (1 - ed) + c.to[1] * eo;
        const roll = c.rest + c.from[2] * (1 - ed) + c.to[2] * eo;
        const lift = 1 + 0.07 * Math.sin(Math.PI * kf) - 0.12 * eo;
        const rot = orbit(phi, params.tilt);
        const L = planeMap(warp(K, ortho(rot)), [1, 0, 0], [0, 1, 0]);
        const M = mul2(chMat(roll, 0, lift, lift), L);
        const shown = t >= c.deal0 && (c.off0 === null || ko < 1);
        return { M, T: [tx, ty] as [number, number], f: facing(rot, [0, 0, -1]), shown, c };
      });
      for (const u of s.units) {
        const p = u.data.layout as Placed | undefined;
        if (!p) continue;
        const q = pose[p.card]!;
        const M = p.side === 'back' ? mul2(q.M, mirror) : q.M;
        u.ch.visible &&= q.shown && (p.side === 'face' ? q.f > 0.01 : q.f < -0.01);
        const cx = q.c.x + q.c.w / 2;
        const cy = q.c.y + q.c.h / 2;
        const o = originPx(u);
        const v = apply2(M, [o[0] - cx, o[1] - cy]);
        composeOuter(u.ch, [cx + q.T[0] + v[0] - o[0], cy + q.T[1] + v[1] - o[1]], M);
      }
    }
  },

  /** Cards and their timelines live in `section.data.layout`. */
  fingerprint: () => 'card-deck@1',

  /**
   * Paper: a swipe as each card is dealt, a tick as it lands, a short high swipe for the flip, a whoosh to fly off.
   * Nothing in the first QUIET s, where the music's short-term loudness is still near silence (the first card is
   * already on its way in at t = 0).
   */
  sounds({ layer, params }) {
    const out: SoundCue[] = [];
    for (const s of layer.sections) {
      const { cards } = s.data.layout as { cards: Card[] };
      const pan = s.dir === 'rtl' ? 0.35 : -0.35;
      cards.forEach((c, i) => {
        out.push({ t: c.deal0, until: c.flip0, kind: 'swipe', weight: 0.3, pan, pitch: -2 + i, section: s.id });
        out.push({ t: c.flip0 - 0.02, kind: 'tick', weight: 0.2, pitch: -4, section: s.id });
        out.push({ t: c.flip0 + 0.04, until: c.flip1, kind: 'swipe', weight: 0.22, pitch: 5, section: s.id });
      });
      const off = cards[0]?.off0;
      if (off !== null && off !== undefined) out.push({ t: off, until: off + params.off, kind: 'whoosh', weight: 0.4, pan: -pan, section: s.id });
    }
    return out.filter((c) => c.t >= QUIET);
  },
});
