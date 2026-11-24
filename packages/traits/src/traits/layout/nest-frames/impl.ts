/**
 * Droste card (infinite-zoom). The safe rect is one card. Its text is a tall stack in the free band above a centred
 * hole (the camera aims there, so the next layer — scaled by `nest` — grows out of that hole). The hole holds a
 * decoration of the next card: fill, border, and a scaled copy of its words (item < 0, so QA ignores it). The last
 * card has no hole. Preview pieces hide at `out`, the frame the real next layer becomes visible.
 */
import type { Section, Host } from '../../../contract.ts';
import { defineLayout } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { placeBlock, stackOpts } from '../../../lib/scroll.ts';
import { chooseRows, placeTok, roleBlocks } from '../../../lib/rowset.ts';
import { meta } from './meta.ts';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Fit {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const nextLayer = (s: Section): Section | null => (s.next && s.next.layer !== s.layer ? s.next : null);

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const card: Box = { x: safe.left, y: safe.top, w: safe.w, h: safe.h };
    const nest = params.nest;
    const pad = Math.max(12, Math.round(0.028 * Math.min(card.w, card.h)));
    for (const s of layer.sections) {
      const next = nextLayer(s);
      const hole = next ? centred(card, nest) : null;
      const fit = hole ? above(card, hole, pad) : inset(card, pad);
      placeBig(host, s, fit, params.cap * Math.max(48, fit.y1 - fit.y0), params.plain, params.leading);
      s.bounds = { x0: card.x, y0: card.y, x1: card.x + card.w, y1: card.y + card.h };
      panel(host, s, card, {
        deco: 'card',
        fill: mix(s.palette.text, s.palette.bg, 0.14),
        border: host.accent(0, s),
        stroke: 5,
        radius: 28,
        z: -6,
      });
      if (hole && next) paintHole(host, s, next, hole, nest, pad);
    }
  },
  /** The real next layer takes the hole at `out`. Drop the decoration so the two copies never stack. */
  frame({ layer }, t) {
    for (const s of layer.sections) {
      if (!nextLayer(s) || t < s.timing.out) continue;
      for (const u of s.units) {
        if (!u.deco?.startsWith('mini')) continue;
        u.ch.opacity *= 0;
        u.ch.visible &&= false;
      }
    }
  },
});

/** Narrow stack (one emphasis per row when that is larger) centred in `fit`. */
function placeBig(host: Host, s: Section, fit: Fit, cap: number, plain: number, leading: number): void {
  const so = stackOpts(host, s, fit, { cap, plain, leading, wt: 700, pin: true });
  const blocks = roleBlocks(host, s, { plain, wt: 700, pin: true });
  s.place = { x: 0, y: 0, rot: 0 };
  s.frame = { x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 };
  if (!blocks.length || fit.y1 - fit.y0 < 24 || fit.x1 - fit.x0 < 24) return;
  const { rows, size } = chooseRows(host, blocks, so, false);
  placeBlock(host, s, rows, size, so);
  for (const u of s.units) if (u.item >= 0) u.z = 3;
}

/**
 * The hole is the next card at scale `nest`: its fill, its border, and its words large enough to read. A closed
 * next card (the last section) also shows that card's logos. No second empty frame — the miniature is the preview.
 */
function paintHole(host: Host, s: Section, next: Section, hole: Box, nest: number, pad: number): void {
  panel(host, s, hole, {
    deco: 'mini',
    fill: mix(host.accent(0, next), s.palette.bg, 0.34),
    border: host.accent(0, next),
    stroke: Math.max(3, Math.round(6 * nest)),
    radius: Math.max(10, Math.round(28 * nest)),
    z: -4,
  });
  placePreview(host, s, next, inset(hole, Math.max(8, Math.round(pad * nest))));
}

/** Decoration copy of `next`'s words (and logos, when it is a closed end card). Not a content unit. */
function placePreview(host: Host, s: Section, next: Section, fit: Fit): void {
  const words = next.units.filter((u) => u.item >= 0 && !!u.text && u.kind !== 'logos');
  const logos = next.units.some((u) => u.kind === 'logos') && host.reel.logos.length > 0;
  const width = fit.x1 - fit.x0;
  const height = fit.y1 - fit.y0;
  if (width < 8 || height < 8 || (!words.length && !logos)) return;
  const wt = 700;
  const gap = 0.14;
  const ms = words.map((u) => host.metrics(u.text, wt, u.ltr));
  const width1 = Math.max(1, ...ms.map((m) => m.bl + m.br));
  const height1 = ms.reduce((a, m) => a + m.ia + m.id, 0) + gap * Math.max(0, words.length - 1);
  const logoShare = logos ? (words.length ? 0.36 : 0.86) : 0;
  const textH = height * (1 - logoShare) - (logos && words.length ? 0.04 * height : 0);
  const S = words.length ? Math.max(1, Math.min(width / width1, Math.max(1, textH) / Math.max(0.01, height1))) : 0;
  const blockH = S * height1;
  const cx = (fit.x0 + fit.x1) / 2;
  let top = fit.y0 + Math.max(0, (textH - blockH) / 2);
  words.forEach((src, i) => {
    const m = ms[i]!;
    const inkW = (m.bl + m.br) * S;
    const u = host.deco(s, {
      deco: 'mini-word',
      text: src.text,
      ltr: src.ltr,
      revealed: true,
      color: s.palette.text,
      z: 1,
    });
    placeTok(u, m, cx - inkW / 2, top + m.ia * S, S, wt);
    top += (m.ia + m.id + gap) * S;
  });
  if (!logos) return;
  const b = logoBadge(host, s, host.reel.logos, width, {
    logoH: height * logoShare * 0.7,
    pad: Math.max(4, height * 0.04),
    gap: Math.max(4, width * 0.04),
    radius: Math.max(6, height * 0.06),
    fill: mix(s.palette.text, s.palette.bg, 0.92),
    border: s.palette.text,
    shadow: null,
  });
  const u = host.deco(s, { deco: 'mini-logo', revealed: true, z: 1, mount: b.mount, mountKey: b.key });
  u.box = { x: cx - b.w / 2, y: fit.y1 - b.h - 2, w: b.w, h: b.h };
  u.innerStyle = { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` };
}

function panel(
  host: Host,
  s: Section,
  box: Box,
  o: { deco: string; fill: string; border: string; stroke: number; radius: number; z: number },
): void {
  host.deco(s, {
    deco: o.deco,
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.max(2, Math.round(box.w)), h: Math.max(2, Math.round(box.h)) },
    z: o.z,
    style: {
      background: o.fill,
      border: `${o.stroke}px solid ${o.border}`,
      'box-sizing': 'border-box',
      'border-radius': `${Math.round(o.radius)}px`,
    },
  });
}

function centred(outer: Box, nest: number): Box {
  const w = nest * outer.w;
  const h = nest * outer.h;
  return { x: outer.x + (outer.w - w) / 2, y: outer.y + (outer.h - h) / 2, w, h };
}

function inset(box: Box, pad: number): Fit {
  return { x0: box.x + pad, y0: box.y + pad, x1: box.x + box.w - pad, y1: box.y + box.h - pad };
}

/** The band of `outer` strictly above `hole`. */
function above(outer: Box, hole: Box, pad: number): Fit {
  return { x0: outer.x + pad, y0: outer.y + pad, x1: outer.x + outer.w - pad, y1: hole.y - pad };
}

function mix(fg: string, bg: string, k: number): string {
  return `color-mix(in srgb, ${fg} ${Math.round(k * 100)}%, ${bg})`;
}
