/**
 * Grid re-flow layout (see meta). Setup solves the module grid once per landing step (the first k units of the
 * section, k = 1…n) with `solveGrid`; the hold shows step n. At every frame each unit's ink rect and each module's
 * rect are step n's plus the eased differences of the steps that its later landings bring (overlapping moves just
 * add), applied as translate + uniform scale (origin at the box's top-left). Modules are trait-owned boxes in
 * `layer.back`, rewritten every frame. When the previous section is also a grid re-flow, its modules are carried
 * (moved, recoloured) into this section's first span during the incoming window.
 */
import { clamp01, visualOrder } from '@reel/runtime';
import { defineLayout, type Host, type Metrics, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import {
  reflowSwipes,
  applyPlace,
  exitSpan,
  flipAt,
  fontWeight,
  inkH,
  inkOn,
  inkW,
  lerpBox,
  mixRgba,
  moduleGrid,
  putBox,
  rgbaArr,
  setText,
  spanBox,
  type Box,
  type Placed,
} from '../../../lib/modules.ts';
import { subScale } from '../../../lib/subline.ts';
import { meta } from './meta.ts';
import { solveGrid, type GridItem, type GridLine, type GridSpec } from './solve.ts';

/** Logo badge proportions per unit of logo height. */
const BADGE = { logoH: 1, pad: 0.2, gap: 0.3 };
/** The re-flow move starts this long before the landing that causes it. */
const LEAD = 0.14;
/** A new module grows from its start edge over this long. */
const GROW = 0.3;

interface Tile {
  /** Solid fill (`#RRGGBB`) or null (ruled module). */
  fill: string | null;
  rule: string;
}
/** `section.data.layout` (fingerprinted). */
interface Data {
  /** steps[k][i]: unit i once units 0…k have landed. */
  steps: Placed[][];
  tiles: Tile[];
  /** Module rule thickness, px. */
  rule: number;
  /** The previous grid section's modules at its hold, carried into span 0 of step 0. */
  carry: { from: Box[]; tiles: Tile[]; t0: number; t1: number } | null;
}

const doms = new WeakMap<Section, { tiles: HTMLElement[]; carry: HTMLElement[] }>();

/** Module of a unit: solid red hero, solid black numbers, emphasis alternating solid blue / red rule, else ruled. */
function tileOf(host: Host, s: Section, u: Unit, nth: number): Tile {
  const p = s.palette;
  if (u.tags.hero) return { fill: host.accent(0, s), rule: p.text };
  if (u.tags.numeric) return { fill: p.text, rule: p.text };
  if (u.emphasis && u.kind !== 'logos') return (nth + s.index) % 2 === 0 ? { fill: host.accent(1, s), rule: p.text } : { fill: null, rule: host.accent(0, s) };
  return { fill: null, rule: p.text };
}

/** Units in grid order with their solver items (the logo badge is an item with the badge's proportions). */
function itemsOf(host: Host, s: Section, rule: number): { u: Unit; m: Metrics | null; wt: number; tile: Tile; it: GridItem }[] {
  const logos = host.reel.logos;
  const badge = {
    w: logos.reduce((a, l) => a + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
    h: BADGE.logoH + 2 * BADGE.pad,
  };
  let nth = 0;
  return s.units
    .filter((u) => u.item >= 0)
    .map((u) => {
      const tile = tileOf(host, s, u, u.emphasis && !u.tags.hero && !u.tags.numeric ? nth++ : 0);
      const top = tile.fill ? 0 : rule;
      if (u.kind === 'logos') return { u, m: null, wt: 400, tile, it: { w1: badge.w, h1: badge.h, weight: 1.2, top } };
      const sub = u.kind === 'sub';
      const strong = !sub && (u.tags.hero || u.tags.numeric || u.emphasis);
      const wt = fontWeight(host, sub ? 400 : strong ? 800 : u.kind === 'weekday' || u.kind === 'city' || u.kind === 'list-title' ? 500 : 700);
      const m = host.metrics(u.text, wt, u.ltr);
      const weight = sub ? 0.32 : u.tags.hero ? 2 : strong ? 1.6 : u.graphemes <= 2 ? 0.5 : u.graphemes <= 3 ? 0.8 : 1;
      return { u, m, wt, tile, it: { w1: inkW(m), h1: inkH(m), weight, top } };
    });
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    for (const s of layer.sections) {
      const content = s.units.filter((u) => u.item >= 0);
      if (s.role === 'title') {
        const ws = content.filter((u) => u.kind === 'word');
        if (ws.length) ws.at(-1)!.tags.hero = true;
      }
      if (s.role === 'datetime' || s.role === 'stat' || s.role === 'countdown') {
        const v = content.find((u) => u.kind === 'date' || u.kind === 'stat' || u.kind === 'countdown');
        if (v) v.tags.hero = true;
      }

      const hi = host.zoomRange(s)[1] * 1.005;
      const G0 = moduleGrid(host, hi);
      const pad = Math.max(8, 0.09 * Math.min(G0.cw, G0.rh));
      const rule = Math.max(3, 0.016 * Math.min(G0.cw, G0.rh)) * params.rule;
      const items = itemsOf(host, s, rule);
      const n = items.length;
      const per = Math.max(Math.round(params.per) + (G0.cols >= 6 ? 1 : 0), Math.ceil(n / G0.rows));
      const tiles = items.map((x) => x.tile);
      const spec: GridSpec = { cols: G0.cols, rows: G0.rows, cw: G0.cw, rh: G0.rh, g: G0.g, pad };
      const rtl = s.dir === 'rtl';

      /** Paint `lines` centred in module-rows [top, top+rows). */
      const paint = (lines: GridLine[], top: number, rows: number, placed: Placed[], line0: number, tag: boolean): number => {
        const used = lines.reduce((a, l) => a + l.rows, 0);
        let row = top + Math.floor((rows - used) / 2);
        let li = line0;
        for (const l of lines) {
          const idx = Array.from({ length: l.to - l.from + 1 }, (_, j) => l.from + j);
          const order = visualOrder(
            idx.map((i) => items[i]!.u.text || (rtl ? '\u200F' : '\u200E')),
            s.dir,
          );
          let col = 0;
          for (const o of order) {
            const i = idx[o]!;
            const cs = l.cols[o]!;
            const box = spanBox(G0, col, row, cs, l.rows);
            col += cs;
            const { it } = items[i]!;
            const inset = tiles[i]!.fill ? 0 : rule;
            const S = Math.min((box.w - 2 * pad) / it.w1, (box.h - 2 * pad - inset) / it.h1);
            const w = it.w1 * S;
            const x = rtl ? box.x + box.w - pad - w : box.x + pad;
            placed[i] = { box, S, x, y: box.y + pad + inset };
            if (tag) items[i]!.u.tags.line = li;
          }
          row += l.rows;
          li++;
        }
        return li;
      };
      const steps: Placed[][] = [];
      for (let k = 0; k < n; k++) {
        const slice = items.slice(0, k + 1);
        const subFrom = slice.findIndex((r) => r.u.kind === 'sub');
        const placed: Placed[] = [];
        if (subFrom <= 0) {
          const lines = solveGrid(slice.map((r) => r.it), spec, per);
          if (!lines) throw new Error(`grid-reflow: ${s.id} does not fit the ${G0.cols}×${G0.rows} grid`);
          paint(lines, 0, G0.rows, placed, 0, k === n - 1);
        } else {
          const nSub = slice.length - subFrom;
          const reserve = Math.min(
            Math.max(1, Math.ceil(nSub / Math.max(1, Math.min(per, G0.cols)))),
            Math.max(1, G0.rows - 2),
          );
          const bigSpec = { ...spec, rows: G0.rows - reserve };
          const subSpec = { ...spec, rows: reserve };
          const big = solveGrid(slice.slice(0, subFrom).map((r) => r.it), bigSpec, per);
          const sub = solveGrid(slice.slice(subFrom).map((r) => r.it), subSpec, per);
          const lines = big && sub
            ? null
            : solveGrid(slice.map((r) => r.it), spec, per);
          if (big && sub) {
            const tag = k === n - 1;
            paint(big, 0, bigSpec.rows, placed, 0, tag);
            // Equal columns, then one shared size, so a short word cannot outgrow the caption.
            const evenCols = sub.map((l) => {
              const count = l.to - l.from + 1;
              const base = Math.floor(G0.cols / count);
              let extra = G0.cols - base * count;
              return {
                ...l,
                from: l.from + subFrom,
                to: l.to + subFrom,
                cols: Array.from({ length: count }, () => base + (extra-- > 0 ? 1 : 0)),
              };
            });
            paint(evenCols, bigSpec.rows, reserve, placed, big.length, tag);
            const bigS = placed.flatMap((p, i) => (items[i]!.u.kind === 'sub' || !items[i]!.m ? [] : [p.S]));
            const fitted: number[] = [];
            for (let i = subFrom; i < slice.length; i++) if (placed[i]) fitted.push(placed[i]!.S);
            if (bigS.length && fitted.length) {
              const even = Math.min(subScale(bigS), ...fitted);
              for (let i = subFrom; i < slice.length; i++) {
                const p = placed[i];
                if (!p) continue;
                const it = items[i]!.it;
                const inset = tiles[i]!.fill ? 0 : rule;
                const innerW = p.box.w - 2 * pad;
                const innerH = p.box.h - 2 * pad - inset;
                const w = it.w1 * even;
                const h = it.h1 * even;
                p.S = even;
                p.x = p.box.x + pad + Math.max(0, (innerW - w) / 2);
                p.y = p.box.y + pad + inset + Math.max(0, (innerH - h) / 2);
              }
            }
          } else if (lines) {
            paint(lines, 0, G0.rows, placed, 0, k === n - 1);
          } else throw new Error(`grid-reflow: ${s.id} does not fit the ${G0.cols}×${G0.rows} grid`);
        }
        steps.push(placed);
      }

      // typeset every unit at its hold place (the last step)
      const fin = steps[n - 1] ?? [];
      items.forEach(({ u, m, wt }, i) => {
        const p = fin[i]!;
        const t = tiles[i]!;
        if (t.fill) u.data.layout = { ink: inkOn(t.fill, s.palette.bg, s.palette.text) };
        u.origin = '0 0';
        if (!m) {
          const b = logoBadge(host, s, host.reel.logos, p.box.w - 2 * pad, {
            logoH: BADGE.logoH * p.S,
            pad: BADGE.pad * p.S,
            gap: BADGE.gap * p.S,
            radius: 0,
            fill: s.palette.bg,
            border: s.palette.bg,
            shadow: null,
          });
          Object.assign(u, {
            box: { x: p.x, y: p.y, w: b.w, h: b.h },
            textAt: { x: 0, y: 0 },
            innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
            mount: b.mount,
            mountKey: b.key,
            font: { family: 'display', size: p.S, weight: 400 },
          });
          return;
        }
        setText(u, m, p.S, wt, p.x, p.y);
      });

      // carry the previous grid section's modules (same grid: same format and rhythm headroom)
      let carry: Data['carry'] = null;
      const prev = s.prev;
      const pd = prev?.style.traits.layout === meta.id ? (prev.data.layout as Data | undefined) : undefined;
      const x = prev ? exitSpan(prev) : null;
      if (pd && x && n && pd.steps.length) {
        const t1 = Math.max(x.t1 + 0.2, items[0]!.u.at - LEAD);
        carry = { from: pd.steps.at(-1)!.map((p) => p.box), tiles: pd.tiles, t0: x.t1, t1 };
      }
      const data: Data = { steps, tiles, rule, carry };
      s.data.layout = data;
      doms.set(s, {
        tiles: tiles.map(() => host.el('div', 'gr-tile', layer.back)),
        carry: (carry?.from ?? []).map(() => host.el('div', 'gr-tile', layer.back)),
      });
      s.bounds = { x0: host.safe.left, y0: host.safe.top, x1: host.safe.left + host.safe.w, y1: host.safe.top + host.safe.h };
    }
  },

  frame({ layer, params }, t) {
    for (const s of layer.sections) frameSection(s, t, params.move);
  },
  /** A soft swipe under every re-flow move. */
  sounds: ({ layer, params }) => reflowSwipes(layer, LEAD, params.move),
});

/** Eased progress of the re-flow caused by unit j's landing. */
function moveK(s: Section, j: number, t: number, dur: number): number {
  const at = s.units[j]!.at;
  return s.motion.inOut(clamp01((t - (at - LEAD)) / dur));
}

function frameSection(s: Section, t: number, dur: number): void {
  const d = s.data.layout as Data;
  const dom = doms.get(s)!;
  const n = d.steps.length;
  const rtl = s.dir === 'rtl';
  const x = exitSpan(s);
  const xk = x ? clamp01((t - x.t0) / (x.t1 - x.t0)) : 0;
  const handOff = !!s.next && s.next.style.traits.layout === meta.id && s.next.layer !== s.layer;
  const ks = Array.from({ length: n }, (_, j) => (j ? moveK(s, j, t, dur) : 0));

  for (let i = 0; i < n; i++) {
    const p = flipAt(d.steps, i, ks);
    const u = s.units[i]!;
    applyPlace(u, p, d.steps[n - 1]![i]!);
    const c = u.ch;
    if (x && t >= x.t0) {
      c.clip = Math.min(c.clip, 1 - s.motion.inOut(xk));
      c.clipFrom = 'bottom';
      c.visible &&= xk < 1;
    }

    // its module: grows from the start edge as the unit lands (unless carried in), leaves with the section
    const tile = d.tiles[i]!;
    const el = dom.tiles[i]!;
    const st = u.at - LEAD;
    const carried = i === 0 && !!d.carry;
    const g = carried ? (t >= d.carry!.t1 ? 1 : 0) : s.motion.enter(clamp01((t - st) / GROW));
    let box: Box | null = t >= st && g > 0 ? { ...p.box } : null;
    if (box && g < 1) {
      const w = box.w * g;
      if (rtl) box.x += box.w - w;
      box.w = w;
    }
    if (box && x && t >= x.t0) {
      if (handOff) {
        if (t >= x.t1) box = null;
      } else box.h *= 1 - s.motion.inOut(xk);
    }
    paintTile(el, box, tile.fill, tile.rule, d.rule);
  }

  // the previous section's modules gather into this section's first span
  const cy = d.carry;
  dom.carry.forEach((el, k) => {
    if (!cy || t < cy.t0 || t >= cy.t1 || !n) return putBox(el, null);
    const q = s.motion.inOut(clamp01((t - cy.t0) / (cy.t1 - cy.t0)));
    const to = d.steps[0]![0]!.box;
    const from = cy.from[k]!;
    const a = cy.tiles[k]!;
    const b = d.tiles[0]!;
    const fill = mixRgba(rgbaArr(a.fill, b.fill ?? a.rule), rgbaArr(b.fill, a.fill ?? b.rule), q);
    const rule = mixRgba(rgbaArr(a.fill ? null : a.rule, b.rule), rgbaArr(b.fill ? null : b.rule, a.rule), q);
    putBox(el, lerpBox(from, to, q), { background: fill, 'border-top': `${d.rule.toFixed(2)}px solid ${rule}` });
  });
}

function paintTile(el: HTMLElement, box: Box | null, fill: string | null, rule: string, w: number): void {
  putBox(el, box, {
    background: fill ?? 'transparent',
    'border-top': fill ? `0px solid transparent` : `${w.toFixed(2)}px solid ${rule}`,
  });
}
