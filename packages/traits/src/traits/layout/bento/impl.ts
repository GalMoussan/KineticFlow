/**
 * Bento layout (see meta). Setup groups each section's units into tiles, packs them (`packBento`, mirrored for
 * right-to-left reels) on a 6-module grid and typesets each tile's words inside it: runs break into the line count
 * that gives the largest size and hang from the tile's top start corner, a single hero sits in its bottom start
 * corner, the logo badge is centred. Tiles are trait-owned boxes in `layer.back`, rewritten every frame; their
 * geometry and colours live in `section.data.layout`.
 */
import { clamp01 } from '@reel/runtime';
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge, pinSVG } from '../../../lib/deco.ts';
import {
  exitSpan,
  fitLines,
  fontWeight,
  inkOn,
  lerpBox,
  mixRgba,
  moduleGrid,
  placeLines,
  putBox,
  rgbaArr,
  spanBox,
  type Box,
} from '../../../lib/modules.ts';
import { meta } from './meta.ts';
import { mirror, packBento } from './pack.ts';

/** Weight of ln(content area / tile area) in a tile's packing score. */
const HUG = 0.9;
const BADGE = { logoH: 1, pad: 0.16, gap: 0.3 };
type Glyph = 'spark' | 'arrow' | 'ring' | 'pin' | 'clock';

interface Group {
  kind: 'run' | 'hero' | 'logo' | 'icon';
  units: Unit[];
  weight: number;
}
interface TileData {
  box: Box;
  fill: string;
  glyph: Glyph | null;
  glyphColor: string;
  /** Landing times of the tile's units (each presses the tile). */
  lands: number[];
}
/** `section.data.layout` (fingerprinted). */
interface Data {
  tiles: TileData[];
  radius: number;
  /** Re-pack from the previous bento section's tiles, [t0, t1]. */
  carry: { from: TileData[]; t0: number; t1: number } | null;
  /** First section of a bento run: when each tile pops in. */
  pop: number[];
}

const doms = new WeakMap<Section, { tiles: HTMLElement[]; glyphs: HTMLElement[]; extra: HTMLElement[] }>();

function glyphSVG(g: Glyph, size: number, color: string, bg: string): string {
  const open = `<svg width="${size.toFixed(1)}" height="${size.toFixed(1)}" viewBox="0 0 100 100" style="display:block;overflow:visible">`;
  switch (g) {
    case 'spark':
      return `${open}<path d="M50 4C54 36 64 46 96 50C64 54 54 64 50 96C46 64 36 54 4 50C36 46 46 36 50 4Z" fill="${color}"/></svg>`;
    case 'arrow':
      return `${open}<path d="M22 78L76 24M34 22H78V66" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    case 'ring':
      return `${open}<circle cx="50" cy="50" r="36" stroke="${color}" stroke-width="11" fill="none"/><circle cx="50" cy="50" r="12" fill="${color}"/></svg>`;
    case 'clock':
      return `${open}<circle cx="50" cy="50" r="40" stroke="${color}" stroke-width="10" fill="none"/><path d="M50 26V50L66 62" stroke="${color}" stroke-width="10" stroke-linecap="round" fill="none"/></svg>`;
    case 'pin':
      return `<div style="display:flex;justify-content:center">${pinSVG(size, { body: color, hole: bg, shadow: 'transparent' })}</div>`;
  }
}

/** Splits a run into chunks of ≤ 3 words of near-equal length (longer chunks first). */
function chunks(us: Unit[]): Unit[][] {
  const n = Math.ceil(us.length / 3);
  const out: Unit[][] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const len = Math.ceil((us.length - i) / (n - k));
    out.push(us.slice(i, i + len));
    i += len;
  }
  return out;
}

function groupsOf(s: Section): Group[] {
  const content = s.units.filter((u) => u.item >= 0);
  const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
  const out: Group[] = [];
  const run = (us: Unit[], weight = 1) => {
    for (const c of chunks(us)) if (c.length) out.push({ kind: 'run', units: c, weight });
  };
  const hero = (u: Unit, weight = 1.8) => out.push({ kind: 'hero', units: [u], weight });
  switch (s.role) {
    case 'datetime':
      for (const u of content) u.kind === 'date' ? hero(u, 1.6) : run([u], u.kind === 'time' ? 1.3 : 1);
      break;
    case 'location':
      run(of('place'), 1.4);
      run(of('city'), 1.2);
      break;
    case 'list':
      run(of('list-title'), 0.9);
      for (const u of of('list-item')) run([u]);
      break;
    case 'stat':
    case 'countdown':
      for (const u of of('stat', 'countdown')) hero(u, 1.7);
      run(of('word'), 1.1);
      break;
    case 'endcard':
      run(of('word'), 1.2);
      for (const u of of('logos')) out.push({ kind: 'logo', units: [u], weight: 1.6 });
      break;
    default: {
      let plain: Unit[] = [];
      const words = of('word');
      const flush = () => {
        run(plain);
        plain = [];
      };
      for (const u of words) {
        if (u.emphasis || u.tags.hero) {
          flush();
          hero(u, u.tags.hero ? 1.5 : 1.35);
        } else plain.push(u);
      }
      flush();
    }
  }
  return out;
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    for (const s of layer.sections) {
      const content = s.units.filter((u) => u.item >= 0);
      if (s.role === 'title') {
        const ws = content.filter((u) => u.kind === 'word');
        if (ws.length) ws.at(-1)!.tags.hero = true;
      }
      for (const u of content) if (u.kind === 'date' || u.kind === 'stat' || u.kind === 'countdown') u.tags.hero = true;

      const hi = host.zoomRange(s)[1] * 1.005;
      const G = moduleGrid(host, hi, 6, 0.028);
      const cell = Math.min(G.cw, G.rh);
      const pad = 0.26 * cell;
      const minS = 0.06 * Math.min(host.safe.w, host.safe.h);
      const p = s.palette;
      const rtl = s.dir === 'rtl';

      // icon tiles fill out sparse sections
      const groups = groupsOf(s);
      const subs = content.filter((u) => u.kind === 'sub');
      if (subs.length) {
        const hostG = [...groups].reverse().find((g) => g.kind === 'run' || g.kind === 'hero');
        if (hostG) hostG.units.push(...subs);
        else groups.push({ kind: 'run', units: subs, weight: 0.7 });
      }
      const icons = Math.min(Math.round(params.icons), groups.length <= 3 ? 2 : groups.length <= 5 ? 1 : 0);
      const glyphs: Glyph[] =
        s.role === 'location' ? ['pin', 'arrow'] : s.role === 'datetime' ? ['clock', 'spark'] : (['spark', 'arrow', 'ring'] as Glyph[]).slice(s.index % 3).concat(['spark', 'arrow']);
      const iconAt = [1, groups.length + 1];
      const tiles: (Group & { glyph: Glyph | null })[] = groups.map((g) => ({ ...g, glyph: null }));
      for (let k = 0; k < icons; k++) tiles.splice(Math.min(iconAt[k]!, tiles.length), 0, { kind: 'icon', units: [], weight: 0.3, glyph: glyphs[k]! });

      const wts = new Map<Unit, number>();
      const mt = (u: Unit) => host.metrics(u.text, wts.get(u)!, u.ltr);
      for (const t of tiles) {
        for (const u of t.units) {
          wts.set(
            u,
            fontWeight(host, u.kind === 'sub' ? 400 : t.kind === 'hero' ? 800 : u.kind === 'weekday' || u.kind === 'city' || u.kind === 'list-title' ? 500 : 700),
          );
        }
      }
      const px = (w: number, h: number) => ({ w: w * G.cw + (w - 1) * G.g - 2 * pad, h: h * G.rh + (h - 1) * G.g - 2 * pad });
      /** Font size in a `w × h` cell tile and the share of the tile's inside its content covers. */
      const fit = (t: (typeof tiles)[number], w: number, h: number): { S: number; fill: number } => {
        const b = px(w, h);
        if (t.kind === 'icon') return { S: Math.min(b.w, b.h), fill: 1 };
        if (t.kind === 'logo') {
          const S = Math.min(b.w / badge1.w, b.h / badge1.h);
          return { S, fill: (badge1.w * badge1.h * S * S) / (b.w * b.h) };
        }
        const r = fitLines(t.units.map(mt), b.w, b.h);
        return { S: r.S, fill: (r.bw * r.bh * r.S * r.S) / (b.w * b.h) };
      };
      // big text, but tiles that hug their content (so the slack spreads into a real bento mix of shapes)
      const scores = tiles.map((t) => (w: number, h: number) => {
        if (t.kind === 'icon') return t.weight * Math.log(fit(t, w, h).S);
        const { S, fill } = fit(t, w, h);
        return S < minS ? -Infinity : t.weight * Math.log(S) + HUG * Math.log(fill);
      });
      let cells = packBento(scores, G.cols, G.rows);
      if (!cells) throw new Error(`bento: ${s.id} does not pack into the ${G.cols}×${G.rows} grid`);
      if (rtl) cells = mirror(cells, G.cols);

      // colours: hero tomato, emphasis cycles the other accents, plain runs alternate white / ink tiles
      let nth = 0;
      let plain = s.index;
      const data: Data = { tiles: [], radius: params.radius * cell, carry: null, pop: [] };
      tiles.forEach((t, k) => {
        const c = cells![k]!;
        const box = spanBox(G, c.x, c.y, c.w, c.h);
        const emph = t.kind === 'hero' && !t.units[0]!.tags.hero;
        const fill =
          t.kind === 'icon'
            ? host.accent(1 + ((s.index + k) % 3), s)
            : t.kind === 'logo'
              ? '#FFFFFF'
              : t.kind === 'hero'
                ? emph
                  ? host.accent(1 + (nth++ % 3), s)
                  : host.accent(0, s)
                : plain++ % 2
                  ? p.text
                  : '#FFFFFF';
        const ink = inkOn(fill, '#FFFFFF', p.text);
        data.tiles.push({ box, fill, glyph: t.glyph, glyphColor: ink, lands: t.units.map((u) => u.at).filter(Number.isFinite) });
        const inner = { x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: box.h - 2 * pad };

        if (t.kind === 'logo') {
          const u = t.units[0]!;
          const { S } = fit(t, c.w, c.h);
          const b = logoBadge(host, s, logos, badge1.w * S + 1, {
            logoH: BADGE.logoH * S,
            pad: BADGE.pad * S,
            gap: BADGE.gap * S,
            radius: 0,
            fill,
            border: fill,
            shadow: null,
          });
          Object.assign(u, {
            box: { x: inner.x + (inner.w - b.w) / 2, y: inner.y + (inner.h - b.h) / 2, w: b.w, h: b.h },
            textAt: { x: 0, y: 0 },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size: S, weight: 400 },
          });
          return;
        }
        if (t.kind === 'icon') return;
        const small = t.units.filter((u) => u.kind === 'sub');
        if (!small.length) {
          const ms = t.units.map(mt);
          for (const u of t.units) u.data.layout = { ink };
          placeLines(t.units, ms, t.units.map((u) => wts.get(u)!), fitLines(ms, inner.w, inner.h), inner, 'start', t.kind === 'hero' ? 'bottom' : 'top', s.dir);
          return;
        }
        const bigU = t.units.filter((u) => u.kind !== 'sub');
        const topH = inner.h * 0.68;
        const top = { x: inner.x, y: inner.y, w: inner.w, h: topH };
        const bot = { x: inner.x, y: inner.y + topH, w: inner.w, h: inner.h - topH };
        if (bigU.length) {
          const bms = bigU.map(mt);
          const bf = fitLines(bms, top.w, top.h);
          placeLines(bigU, bms, bigU.map((u) => wts.get(u)!), bf, top, 'start', t.kind === 'hero' ? 'bottom' : 'top', s.dir);
          const sms = small.map(mt);
          const sf = fitLines(sms, bot.w, bot.h, 3);
          placeLines(small, sms, small.map((u) => wts.get(u)!), { ...sf, S: Math.min(sf.S, 0.42 * bf.S) }, bot, 'start', 'middle', s.dir);
        } else {
          const sms = small.map(mt);
          placeLines(small, sms, small.map((u) => wts.get(u)!), fitLines(sms, inner.w, inner.h, 3), inner, 'start', 'middle', s.dir);
        }
        for (const u of t.units) u.data.layout = { ink };
      });

      // re-pack from the previous bento section, or pop the tiles in before the first landing
      const prev = s.prev;
      const pd = prev?.style.traits.layout === meta.id ? (prev.data.layout as Data | undefined) : undefined;
      const x = prev ? exitSpan(prev) : null;
      const first = Math.min(...content.map((u) => u.at).filter(Number.isFinite), s.timing.firstLand);
      if (pd && x) data.carry = { from: pd.tiles, t0: x.t1, t1: Math.max(x.t1 + 0.3, first - 0.08) };
      else {
        const t0 = Math.max(s.window?.t0 ?? 0, s.timing.in - 0.15);
        data.pop = data.tiles.map((_, k) => Math.min(t0 + k * 0.07, first - 0.1));
      }
      s.data.layout = data;
      const extra = Math.max(0, (pd?.tiles.length ?? 0) - data.tiles.length);
      const els = data.tiles.map(() => host.el('div', 'bt-tile', layer.back));
      doms.set(s, {
        tiles: els,
        glyphs: data.tiles.map((t, k) => {
          const g = host.el('div', 'bt-glyph', els[k]!);
          if (t.glyph) g.innerHTML = glyphSVG(t.glyph, Math.min(0.5 * Math.min(t.box.w, t.box.h), 1.4 * cell), t.glyphColor, t.fill);
          return g;
        }),
        extra: Array.from({ length: extra }, () => host.el('div', 'bt-tile', layer.back)),
      });
      s.bounds = { x0: host.safe.left, y0: host.safe.top, x1: host.safe.left + host.safe.w, y1: host.safe.top + host.safe.h };
    }
  },

  frame({ layer, params }, t) {
    for (const s of layer.sections) frameSection(s, t, params.press);
  },
});

const shrink = (b: Box, k: number): Box => ({ x: b.x + (b.w * (1 - k)) / 2, y: b.y + (b.h * (1 - k)) / 2, w: b.w * k, h: b.h * k });

function frameSection(s: Section, t: number, press: number): void {
  const d = s.data.layout as Data;
  const dom = doms.get(s)!;
  const m = s.motion;
  const x = exitSpan(s);
  const xk = x ? clamp01((t - x.t0) / (x.t1 - x.t0)) : 0;
  const handOff = !!s.next && s.next.style.traits.layout === meta.id && s.next.layer !== s.layer;
  const cy = d.carry;
  const q = cy ? m.inOut(clamp01((t - cy.t0) / (cy.t1 - cy.t0))) : 1;

  // content leaves with the section: fades and sinks a little
  if (x && t >= x.t0) {
    for (const u of s.units) {
      if (u.item < 0) continue;
      u.ch.opacity *= 1 - xk;
      u.ch.ity += xk * 0.15 * (u.font.size || u.box.h);
      u.ch.visible &&= xk < 1;
    }
  }

  d.tiles.forEach((tile, k) => {
    const el = dom.tiles[k]!;
    const ge = dom.glyphs[k]!;
    let box: Box | null = tile.box;
    let fill = tile.fill;
    let glyph = 1;
    if (cy) {
      if (t < cy.t0) box = null;
      else if (q < 1) {
        const from = cy.from[k];
        box = from ? lerpBox(from.box, tile.box, q) : shrink(tile.box, q);
        fill = mixRgba(rgbaArr(from?.fill ?? tile.fill), rgbaArr(tile.fill), from ? q : 1);
        glyph = tile.glyph ? (from?.glyph === tile.glyph ? 1 : q) : 0;
        if (from?.glyph && !tile.glyph) glyph = 0;
      }
    } else {
      const k0 = clamp01((t - d.pop[k]!) / 0.45);
      if (t < d.pop[k]!) box = null;
      else if (k0 < 1) box = shrink(tile.box, Math.max(0.001, m.bounce(k0, 1.4)));
    }
    // a press when the tile's content lands
    if (box && press) {
      let dip = 0;
      for (const at of tile.lands) {
        const a = t - at;
        if (a > 0 && a < 0.5) dip += Math.exp(-a * 9) * Math.sin(a * 22);
      }
      if (dip) box = shrink(box, 1 - 0.045 * press * dip);
    }
    if (box && x && t >= x.t0) {
      if (handOff) {
        if (t >= x.t1) box = null;
      } else box = shrink(box, Math.max(0.001, 1 - m.exit(xk)));
    }
    putBox(el, box, { background: fill, 'border-radius': `${Math.min(d.radius, box ? Math.min(box.w, box.h) / 2 : 0).toFixed(2)}px` });
    ge.style.opacity = glyph >= 1 ? '1' : glyph.toFixed(3);
  });

  // the previous section's surplus tiles shrink away into their own centres
  dom.extra.forEach((el, j) => {
    const from = cy?.from[d.tiles.length + j];
    if (!cy || !from || t < cy.t0 || q >= 1) return putBox(el, null);
    putBox(el, shrink(from.box, Math.max(0.001, 1 - q)), { background: from.fill, 'border-radius': `${(d.radius * (1 - q)).toFixed(2)}px` });
  });
}
