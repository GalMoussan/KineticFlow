/**
 * Map route (see meta). Waypoints and the stroke are pure functions of the layer index and the section count
 * (`lib/map.ts`): nothing measured from text is stored on the layer, so a date-only edit cannot move the route.
 */
import { defineLayout, type Host, type Section, type Unit } from '../../../contract.ts';
import { logoBadge, pinSVG } from '../../../lib/deco.ts';
import { STREET, measure, routeThrough, waypoints, type Pt } from '../../../lib/map.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { SUB_WEIGHT, subScale, wrapSub } from '../../../lib/subline.ts';
import { advanceOf, fitRows, inkOf, packed, placeRows, row, stackHeight, tok, wordGap, type Block, type Row, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.2;
const LEAD = 0.28;
const MARGIN = 10;
const PIN_GAP = 16;
/** Caption (sub line): leading between its lines and the space above it, × its size. */
const CAP_LEAD = 0.3;
const CAP_GAP = 0.8;

/** `layer.data.layout`. Geometry and clocks only — no text metrics. */
export interface MapLayout {
  seed: number;
  pitch: number;
  step: number;
  route: Pt[];
  cum: number[];
  length: number;
  /** Arc length of each section's waypoint, in section order. */
  marks: number[];
  pinAt: number;
  pinIndex: number;
  t0: number;
  tPin: number;
  tEnd: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default defineLayout({
  meta,
  layout({ host, layer }) {
    const n = layer.sections.length;
    const cells = Math.max(1, Math.ceil((1.35 * Math.max(host.W, host.H)) / STREET));
    const seed = layer.index * 10007 + 17;
    const pts = waypoints(Math.max(1, n), cells, seed);
    const route = routeThrough(pts, seed);
    const { cum, length } = measure(route);
    const marks = marksFor(route, cum, pts);
    const pinIndex = Math.max(0, layer.sections.findIndex((s) => s.role === 'location'));
    const located = layer.sections.some((s) => s.role === 'location');
    const pin = located ? pinIndex : n - 1;
    const first = layer.sections[0]!;
    const last = layer.sections[n - 1]!;
    const t0 = first.timing.in;
    const tPin = layer.sections[pin]!.timing.firstLand;
    const hold = last.timing.holdStart;
    const tEnd = hold > t0 ? hold : Math.max(last.timing.firstLand, t0);
    const layout: MapLayout = {
      seed,
      pitch: STREET,
      step: cells * STREET,
      route,
      cum,
      length,
      marks,
      pinAt: marks[pin] ?? 0,
      pinIndex: pin,
      t0,
      tPin,
      tEnd: tEnd > t0 ? tEnd : t0 + 0.01,
    };
    layer.data.layout = layout;
    layer.sections.forEach((s, i) => placeSection(host, s, pts[i] ?? pts[0]!, i === pin));
  },
});

/** Arc length along `route` of each input waypoint, in order (corners inserted by `routeThrough` are skipped). */
function marksFor(route: readonly Pt[], cum: readonly number[], pts: readonly Pt[]): number[] {
  const marks: number[] = [];
  let j = 0;
  for (const p of pts) {
    while (j < route.length - 1 && (route[j]!.x !== p.x || route[j]!.y !== p.y)) j++;
    marks.push(cum[j] ?? 0);
    if (j < route.length - 1) j++;
  }
  return marks;
}

function placeSection(host: Host, s: Section, wp: Pt, isPin: boolean): void {
  const { safe } = host;
  const z = host.zoomRange(s)[1] || 1;
  const availW = Math.floor(safe.w / z - 2 * MARGIN);
  const availH = Math.floor(safe.h / z - 2 * MARGIN);
  const pinH = isPin ? Math.floor(Math.min(availH * 0.22, (0.18 * Math.min(safe.w, safe.h)) / z)) : 0;
  const gap = isPin ? PIN_GAP : 0;
  const cardW = Math.max(40, availW);
  const cardH = Math.max(40, isPin ? Math.min(Math.floor(availH * 0.62), availH - pinH - gap) : availH);

  let cardX = Math.round(wp.x - cardW / 2);
  let cardY = Math.round(wp.y - cardH / 2);
  let frameX = cardX + cardW / 2;
  let frameY = cardY + cardH / 2;
  let bounds = { x0: cardX, y0: cardY, x1: cardX + cardW, y1: cardY + cardH };

  if (isPin) {
    const size = pinH / 0.9;
    const pinW = size * 0.72;
    const pinX = wp.x - pinW / 2;
    const pinY = wp.y - pinH;
    cardX = Math.round(wp.x - cardW / 2);
    cardY = Math.round(wp.y + gap);
    const u0 = Math.min(pinX, cardX);
    const v0 = pinY;
    const u1 = Math.max(pinX + pinW, cardX + cardW);
    const v1 = cardY + cardH;
    frameX = (u0 + u1) / 2;
    frameY = (v0 + v1) / 2;
    bounds = { x0: u0, y0: v0, x1: u1, y1: v1 };
    const pin = host.deco(s, {
      deco: 'pin',
      z: 3,
      html: pinSVG(size, {
        body: host.accent(0, s),
        hole: mixHex(s.palette.bg, '#ffffff', 0.7),
        shadow: rgba(s.palette.text, 0.35),
      }),
    });
    pin.box = { x: pinX, y: pinY, w: pinW, h: pinH };
    pin.innerStyle = { width: `${pinW.toFixed(2)}px`, height: `${pinH.toFixed(2)}px` };
    pin.revealed = true;
    pin.at = s.timing.in;
  }

  const card = host.deco(s, { deco: 'card', z: -2 });
  card.box = { x: cardX, y: cardY, w: cardW, h: cardH };
  card.style = {
    background: mixHex(s.palette.bg, '#ffffff', 0.55),
    border: `3px solid ${host.accent(0, s)}`,
    'box-sizing': 'border-box',
    'border-radius': '16px',
  };
  card.revealed = true;
  card.at = s.timing.in;

  const pad = Math.max(16, Math.round(0.08 * Math.min(cardW, cardH)));
  const inner: Box = { x: cardX + pad, y: cardY + pad, w: cardW - 2 * pad, h: cardH - 2 * pad };
  const content = s.units.filter((u) => u.item >= 0);
  const logos = content.filter((u) => u.kind === 'logos');
  const words = content.filter((u) => u.kind !== 'logos');
  if (s.role === 'title') {
    const ws = words.filter((u) => u.kind === 'word');
    if (ws.length) ws.at(-1)!.tags.hero = true;
  }
  let text = inner;
  if (logos.length && host.reel.logos.length && inner.h > 72) {
    const reserve = Math.min(Math.floor(inner.h * 0.36), 220);
    text = { ...inner, h: Math.max(24, inner.h - reserve - 8) };
    placeBadge(host, s, logos[0]!, inner.x, inner.y + inner.h - reserve, inner.w, reserve);
  }
  placeText(host, s, words, text);
  paint(host, s, words);
  s.place = { x: 0, y: 0, rot: 0 };
  s.frame = { x: frameX, y: frameY, r: 0, s: 1 };
  s.bounds = bounds;
}

function placeBadge(host: Host, s: Section, u: Unit, x: number, y: number, w: number, h: number): void {
  const pad = h >= 80 ? 12 : 4;
  const b = logoBadge(host, s, host.reel.logos, w, {
    logoH: Math.max(12, Math.min(120, h - 2 * pad - 2)),
    pad,
    gap: pad,
    radius: 12,
    fill: s.palette.bg,
    border: host.accent(0, s),
    shadow: null,
  });
  u.box = { x: x + (w - b.w) / 2, y: y + Math.max(0, (h - b.h) / 2), w: b.w, h: b.h };
  u.textAt = { x: 0, y: 0 };
  u.innerStyle = { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` };
  u.mount = b.mount;
  u.mountKey = b.key;
  u.font = { family: 'display', size: 16, weight: 500 };
}

function placeText(host: Host, s: Section, words: Unit[], box: Box): void {
  if (box.w < 16 || box.h < 16 || !words.length) return;
  const subs = words.filter((u) => u.kind === 'sub');
  if (subs.length) {
    placeWithCaption(host, s, words.filter((u) => u.kind !== 'sub'), subs, box);
    return;
  }
  const blocks = cover(words, blocksFor(s, words));
  const live = blocks.filter((b) => (b.kind === 'row' ? b.row.kind === 'box' || b.row.toks.length : b.toks.length));
  if (!live.length) return;
  const fit = fitRows(host, live, {
    w: box.w,
    h: box.h,
    cap: 0.22 * Math.min(box.w, box.h),
    gap: GAP,
    leading: LEAD,
    wide: box.w >= box.h,
    wordSpace: true,
  });
  const size = Number.isFinite(fit.size) && fit.size >= 1 ? fit.size : 12;
  placeRows(host, fit.rows, size, {
    left: box.x,
    width: box.w,
    top: box.y,
    align: 'center',
    dir: s.dir,
    gap: GAP,
    leading: LEAD,
    wordSpace: true,
  });
}

/**
 * The big words fitted as `placeText` fits them, then the sub words as a caption under them in the same card: at
 * `subScale` of the big lines, the text face at `SUB_WEIGHT`, balanced lines with measured word spaces. The big
 * block's height shrinks until both fit; the pair is centred in the card's text box.
 */
function placeWithCaption(host: Host, s: Section, big: Unit[], subs: Unit[], box: Box): void {
  const live = cover(big, blocksFor(s, big)).filter((b) => (b.kind === 'row' ? b.row.kind === 'box' || b.row.toks.length : b.toks.length));
  const toks = subs.map((u) => tok(u, u.emphasis ? 700 : SUB_WEIGHT, 'text'));
  const adv = toks.map((t) => advanceOf(inkOf(host, t)));
  const space = wordGap(host, toks);
  const opt = { left: box.x, width: box.w, align: 'center' as const, dir: s.dir, gap: GAP, wordSpace: true };
  let h = box.h;
  for (let i = 0; ; i++) {
    let rows: Row[] = [];
    let size = 12;
    let bigH = 0;
    let sizes = [12];
    if (live.length) {
      const fit = fitRows(host, live, { w: box.w, h, cap: 0.22 * Math.min(box.w, box.h), gap: GAP, leading: LEAD, wide: box.w >= box.h, wordSpace: true });
      rows = fit.rows;
      size = Number.isFinite(fit.size) && fit.size >= 1 ? fit.size : 12;
      bigH = stackHeight(host, rows, GAP, LEAD, true) * size;
      sizes = rows.map((r) => r.f * size);
    }
    const Ss = subScale(sizes);
    const lines: Row[] = wrapSub(adv, space, box.w / Ss).map((ix) => ({ kind: 'text', f: 1, toks: ix.map((j) => toks[j]!) }));
    const gap = rows.length ? CAP_GAP * Ss : 0;
    const capH = stackHeight(host, lines, GAP, CAP_LEAD, true) * Ss;
    const next = Math.min(h, bigH) * 0.92;
    if (bigH + gap + capH <= box.h || i >= 14 || next < 16) {
      const top = box.y + Math.max(0, (box.h - bigH - gap - capH) / 2);
      if (rows.length) placeRows(host, rows, size, { ...opt, top, leading: LEAD });
      placeRows(host, lines, Ss, { ...opt, top: top + bigH + gap, leading: CAP_LEAD });
      return;
    }
    h = next;
  }
}

function blocksFor(s: Section, words: Unit[]): Block[] {
  const of = (...kinds: string[]) => words.filter((u) => kinds.includes(u.kind));
  const line = (u: Unit, f: number, family: 'display' | 'text', wt: number) => row(f, [tok(u, wt, family)]);
  switch (s.role) {
    case 'datetime':
      return [
        ...of('weekday').map((u) => line(u, 0.48, 'text', 500)),
        ...of('date').map((u) => line(u, 1.4, 'display', 700)),
        ...of('time').map((u) => line(u, 0.58, 'text', 500)),
      ];
    case 'location':
      return [
        packed(1.05, of('place').map((u) => tok(u, 700, 'display'))),
        ...of('city').map((u) => line(u, 0.55, 'text', 500)),
      ];
    case 'list':
      return [
        ...of('list-title').map((u) => line(u, 1, 'display', 700)),
        ...of('list-item').map((u) => line(u, 0.72, 'text', 560)),
      ];
    case 'stat':
    case 'countdown':
      return [
        ...of('stat', 'countdown').map((u) => line(u, 1.6, 'display', 800)),
        packed(0.55, of('word').map((u) => tok(u, 500, 'text'))),
      ];
    default:
      return [packed(1, words.map((u) => tok(u, u.emphasis ? 700 : 560, u.emphasis ? 'display' : 'text')))];
  }
}

/** Any content unit a role split skipped still gets a row, so nothing keeps the empty box at the origin. */
function cover(words: Unit[], blocks: Block[]): Block[] {
  const used = new Set<Unit>();
  for (const b of blocks) {
    const toks: Tok[] = b.kind === 'row' ? (b.row.kind === 'text' ? b.row.toks : []) : b.toks;
    if (b.kind === 'row' && b.row.kind === 'box') used.add(b.row.u);
    for (const t of toks) used.add(t.u);
  }
  const rest = words.filter((u) => !used.has(u));
  if (rest.length) blocks.push(packed(0.7, rest.map((u) => tok(u, 500, 'text'))));
  return blocks;
}

function paint(host: Host, s: Section, words: Unit[]): void {
  for (const u of words) {
    const numeric = u.kind === 'date' || u.kind === 'time' || u.kind === 'stat' || u.kind === 'countdown';
    if (numeric) u.tags.numeric = true;
    const ink = numeric ? host.accent(1, s) : u.emphasis || u.tags.hero ? host.accent(0, s) : s.palette.text;
    u.data.layout = { ink };
  }
}
