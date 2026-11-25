/**
 * Orbit rings (see meta). Text is fitted into the bands above and below the hub, inside the safe area, so a hold
 * (identity channels) reads on a straight line and does not cover the logo. Each text row records the ring that
 * passes through its ends; the reveal draws those rings and rides the graphemes.
 */
import { defineLayout, type Host, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { mixHex } from '../../../lib/neon.ts';
import { fitWithSub } from '../../../lib/pathtext.ts';
import { SUB_WEIGHT, subUnits } from '../../../lib/subline.ts';
import { packed, placeRows, row, tok, type Block, type Tok } from '../../../lib/typeset.ts';
import { meta } from './meta.ts';

const GAP = 0.24;
const LEAD = 0.28;
/** Sub words: a step under the big words' 560 (SUB_WEIGHT is too close to it to read as lighter). */
const SUB_LIGHT = SUB_WEIGHT - 100;

/** One chord. `r` is the ring radius whose chord is this line; `y` is the line's mid y. */
export interface OrbitRow {
  y: number;
  r: number;
  cx: number;
  hw: number;
}

export interface OrbitSection {
  cx: number;
  cy: number;
  hub: number;
  rows: OrbitRow[];
}

/** `unit.data.layout`: which ring the unit's graphemes ride; sub words also carry their softer ink (tile-ink). */
export interface OrbitUnit {
  row: number;
  ink?: string;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const logos = host.reel.logos;
    for (const s of layer.sections) {
      const z = host.zoomRange(s)[1];
      const cx = safe.cx;
      const cy = safe.cy;
      const hub = (params.hub * Math.min(safe.w, safe.h)) / z;
      const gap = hub * 0.45 + 8;
      const cap = (params.cap * Math.min(safe.w, safe.h)) / z;
      const width = (safe.w - 16) / z;
      const left = safe.cx - width / 2;
      const upper: Band = { x: left, y: safe.top + 8, w: width, h: Math.max(24, cy - hub - gap - (safe.top + 8)) };
      const lower: Band = { x: left, y: cy + hub + gap, w: width, h: Math.max(24, safe.top + safe.h - 8 - (cy + hub + gap)) };
      placeHub(host, s, cx, cy, hub * 2, logos);
      const { upper: up, lower: lo } = bands(s);
      // sub words: a small caption under the big words, in the lower band (the upper one when the lower is empty)
      const subs = subUnits(s.units).map((u) => tok(u, u.emphasis ? 560 : SUB_LIGHT));
      const rows: OrbitRow[] = [];
      lay(host, s, up, upper, cap, rows, cx, cy, hub, lo.length ? [] : subs);
      lay(host, s, lo, lower, cap, rows, cx, cy, hub, lo.length ? subs : []);
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: cx, y: cy, r: 0, s: 1 };
      s.bounds = null;
      s.data.layout = { cx, cy, hub, rows } satisfies OrbitSection;
      if (s.role === 'title') {
        const ws = s.units.filter((u) => u.item >= 0 && u.kind === 'word');
        if (ws.length) ws.at(-1)!.tags.hero = true;
      }
    }
  },
});

interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

function placeHub(host: Host, s: Section, cx: number, cy: number, size: number, logos: Host['reel']['logos']): void {
  const logoUnit = s.units.find((u) => u.item >= 0 && u.kind === 'logos');
  if (logoUnit && logos.length) {
    badge(host, s, logoUnit, cx, cy, size, logos);
    return;
  }
  if (logos.length && s.role !== 'endcard') {
    const u = host.deco(s, { deco: 'hub', z: 1 });
    badge(host, s, u, cx, cy, size * 0.92, logos);
    u.revealed = false;
    return;
  }
  const d = size * 0.72;
  const u = host.deco(s, { deco: 'hub', z: 1 });
  u.box = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
  u.style = { background: host.accent(0, s), 'border-radius': '50%' };
  u.revealed = false;
}

function badge(host: Host, s: Section, u: Unit, cx: number, cy: number, size: number, logos: Host['reel']['logos']): void {
  const b = logoBadge(host, s, logos, size * 1.35, {
    logoH: size * 0.42,
    pad: size * 0.08,
    gap: size * 0.08,
    radius: size * 0.16,
    fill: s.palette.bg,
    border: host.accent(1, s),
    shadow: null,
  });
  u.box = { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h };
  u.textAt = { x: 0, y: 0 };
  u.innerStyle = { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` };
  u.mount = b.mount;
  u.mountKey = b.key;
  u.font = { family: 'display', size: 16, weight: 500 };
}

function bands(s: Section): { upper: Block[]; lower: Block[] } {
  const content = s.units.filter((u) => u.item >= 0 && u.kind !== 'logos');
  const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
  const t = (u: Unit, f = 1) => tok(u, u.emphasis ? 700 : 560);
  switch (s.role) {
    case 'datetime':
      return {
        upper: [...of('weekday').map((u) => row(0.45, [t(u)])), ...of('date').map((u) => row(1.2, [t(u, 1)]))],
        lower: of('time').map((u) => row(0.7, [t(u)])),
      };
    case 'location':
      return { upper: [packed(1, of('place').map((u) => t(u)))], lower: of('city').map((u) => row(0.65, [t(u)])) };
    case 'list':
      return {
        upper: of('list-title').map((u) => row(0.8, [t(u)])),
        lower: of('list-item').map((u) => row(0.7, [t(u)])),
      };
    case 'stat':
    case 'countdown':
      return {
        upper: of('stat', 'countdown').map((u) => row(1.25, [t(u)])),
        lower: [packed(0.6, of('word').map((u) => t(u)))],
      };
    default: {
      const ws = content.filter((u) => u.kind !== 'sub');
      if (ws.length <= 1) return { upper: [packed(1, ws.map((u) => t(u)))], lower: [] };
      const mid = Math.ceil(ws.length / 2);
      return { upper: [packed(1, ws.slice(0, mid).map((u) => t(u)))], lower: [packed(0.9, ws.slice(mid).map((u) => t(u)))] };
    }
  }
}

function lay(host: Host, s: Section, blocks: Block[], band: Band, cap: number, rows: OrbitRow[], cx: number, cy: number, hub: number, subs: Tok[]): void {
  const live = blocks.filter((b) => (b.kind === 'row' ? b.row.kind === 'box' || b.row.toks.length : b.toks.length));
  if (!live.length) return;
  const fit = fitWithSub(host, live, subs, { w: band.w, h: band.h, cap, gap: GAP, leading: LEAD, wide: true });
  if (!Number.isFinite(fit.size) || fit.size < 1) return;
  const rects = placeRows(host, fit.rows, fit.size, {
    left: band.x,
    width: band.w,
    top: band.y,
    align: 'center',
    dir: s.dir,
    gap: GAP,
    leading: LEAD,
  });
  fit.rows.forEach((r, i) => {
    if (r.kind !== 'text' || !r.toks.length) return;
    const rc = rects[i]!;
    const y = (rc.top + rc.bottom) / 2;
    const hw = Math.max(4, (rc.x1 - rc.x0) / 2);
    const orbit: OrbitRow = { y, r: Math.max(hub + 10, Math.hypot(hw + 6, Math.abs(y - cy))), cx, hw };
    const index = rows.length;
    rows.push(orbit);
    const small = i >= fit.sub;
    const ink = mixHex(s.palette.text, s.palette.bg, 0.22);
    for (const tok of r.toks) tok.u.data.layout = (small && !tok.u.emphasis ? { row: index, ink } : { row: index }) satisfies OrbitUnit;
    // A ring stroke behind the line (a thin, dim one behind a sub line). The reveal dashes it in.
    const color = small ? mixHex(s.palette.text, s.palette.bg, 0.6) : host.accent(index, s);
    host.deco(s, {
      deco: 'ring',
      z: -2,
      box: { x: 0, y: 0, w: host.W, h: host.H },
      html:
        `<svg width="${host.W}" height="${host.H}" viewBox="0 0 ${host.W} ${host.H}" style="position:absolute;left:0;top:0;overflow:visible">` +
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${orbit.r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${small ? 1.5 : 2.5}"/>` +
        `</svg>`,
      revealed: true,
      at: s.timing.in,
      data: { reveal: { index } },
    });
  });
}
