/**
 * Ribbon flow (see meta). Setup turns each row's ribbon (layout data) into an arc-length polyline and a band
 * decoration (a frame-sized SVG: darker edge stroke under the band stroke, both dashed per frame to show the drawn
 * stretch). Mount measures every glyph's place on its band: the arc length of its centre's foot on the straight run
 * and its offset from the band's centre line. A unit is a rigid train: all its glyphs sit `D` behind their places
 * along the band, D easing from "everything before the band's start" to 0 at the landing; at D = 0 the channels are
 * left untouched (exact hold). Exits push the row's trains on by a common `X` past the band's end.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { cubic, partCentre, Polyline, ride, type Pt } from '../../../lib/pathtext.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import type { RibbonSection, RibbonUnit } from '../../layout/ribbon-band/impl.ts';
import { meta } from './meta.ts';

/** One glyph (or a whole unit without parts) on its band. */
interface Item {
  ch: { tx: number; ty: number; rot: number };
  home: Pt;
  off: number;
  s: number;
}
interface Rider {
  row: number;
  items: Item[];
  /** Arc-length extent of the unit's glyphs at rest, and the train's starting distance behind them. */
  sMin: number;
  sMax: number;
  D0: number;
}
interface Band {
  row: number;
  paths: SVGPathElement[];
}

const tracks = new WeakMap<Section, Polyline[]>();
const bands = new WeakMap<Section, Band[]>();
const riders = new WeakMap<Unit, Rider>();
/** Exit run per row: distance that takes every glyph past the band's end. */
const exitRuns = new WeakMap<Section, number[]>();

const rowOf = (u: Unit) => (u.data.layout as RibbonUnit | undefined)?.row ?? 0;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item < 0) return;
    if (u.text && u.kind !== 'logos') u.split = 'grapheme';
    else u.origin = '50% 50%';
  },
  setup({ host, section }) {
    const d = section.data.layout as RibbonSection;
    const lines = d.rows.map((r) => new Polyline([...cubic(...r.entry), ...cubic(...r.exit)]));
    tracks.set(section, lines);
    d.rows.forEach((r, i) => {
      const L = lines[i]!.length.toFixed(2);
      const path = lines[i]!.d();
      const stroke = (c: string, w: number) =>
        `<path d="${path}" pathLength="${L}" fill="none" stroke-linecap="butt" stroke-linejoin="round" style="stroke:${c};stroke-width:${w.toFixed(2)}px"/>`;
      host.deco(section, {
        deco: 'ribbon',
        box: { x: 0, y: 0, w: host.W, h: host.H },
        html:
          `<svg width="${host.W}" height="${host.H}" viewBox="0 0 ${host.W} ${host.H}" style="position:absolute;left:0;top:0;overflow:visible">` +
          `${stroke(r.edge, 2 * r.half + Math.max(4, r.half * 0.12))}${stroke(r.color, 2 * r.half)}</svg>`,
        z: -2,
        data: { reveal: { row: i } },
      });
    });
  },
  mount({ host, section }) {
    const d = section.data.layout as RibbonSection;
    const lines = tracks.get(section)!;
    const list: Band[] = [];
    const runs = d.rows.map(() => 0);
    const lo = d.rows.map(() => Infinity);
    for (const u of section.units) {
      if (u.deco === 'ribbon') {
        list.push({ row: (u.data.reveal as { row: number }).row, paths: [...u.inner!.querySelectorAll('path')] });
        continue;
      }
      if (u.item < 0 || !u.revealed) continue;
      const row = rowOf(u);
      const line = lines[row]!;
      const y = d.rows[row]!.y;
      const items: Item[] = u.parts.length
        ? u.parts.map((p) => {
            const home = partCentre(u, p);
            return { ch: p.ch, home, off: y - home.y, s: line.project({ x: home.x, y }) };
          })
        : (() => {
            const home = { x: u.box.x + u.box.w / 2, y: u.box.y + u.box.h / 2 };
            return [{ ch: u.ch, home, off: y - home.y, s: line.project({ x: home.x, y }) }];
          })();
      const sMin = Math.min(...items.map((i) => i.s));
      const sMax = Math.max(...items.map((i) => i.s));
      const half = d.rows[row]!.half;
      riders.set(u, { row, items, sMin, sMax, D0: sMax + 2 * half + 0.05 * host.W });
      lo[row] = Math.min(lo[row]!, sMin);
    }
    d.rows.forEach((r, i) => {
      runs[i] = Number.isFinite(lo[i]!) ? lines[i]!.length - lo[i]! + 2 * r.half + 0.05 * host.W : 0;
    });
    bands.set(section, list);
    exitRuns.set(section, runs);
  },
  frame({ section, params }, t) {
    const d = section.data.layout as RibbonSection;
    const lines = tracks.get(section)!;
    const runs = exitRuns.get(section)!;
    const m = section.motion;
    const ex = exitWindow(section);
    const ke = ex && t >= ex.t0 ? clamp01((t - ex.t0) / Math.min(params.exit, ex.t1 - ex.t0)) : 0;
    const exiting = ke > 0;
    const n = d.rows.length;
    const head = Array.from({ length: n }, () => 0);
    const tail = Array.from({ length: n }, () => (exiting ? Infinity : 0));
    const start = Array.from({ length: n }, () => Infinity);
    for (const u of section.units) {
      const r = riders.get(u);
      if (!r || !u.revealed) continue;
      const st = u.at - params.travel;
      start[r.row] = Math.min(start[r.row]!, st);
      u.ch.visible &&= t >= st;
      if (t < st) continue;
      const k = clamp01((t - st) / params.travel);
      const shift = (exiting ? runs[r.row]! * m.exit(ke) : 0) - r.D0 * (1 - m.enter(k));
      const half = d.rows[r.row]!.half;
      head[r.row] = Math.max(head[r.row]!, r.sMax + shift + half);
      if (exiting) tail[r.row] = Math.min(tail[r.row]!, r.sMin + shift - half);
      if (shift === 0) continue; // at rest: exact hold
      const line = lines[r.row]!;
      for (const it of r.items) ride(it.ch, it.home, it.off, line.at(it.s + shift));
    }
    for (const b of bands.get(section)!) {
      const L = lines[b.row]!.length;
      const k = clamp01((t - (start[b.row]! - 0.2)) / params.draw);
      const h = Math.min(L, Math.max(L * m.inOut(k), head[b.row]!));
      const tl = Math.max(0, Math.min(L, tail[b.row]!));
      const vis = h - tl;
      for (const p of b.paths) {
        p.style.visibility = vis > 0.5 ? 'visible' : 'hidden';
        p.style.strokeDasharray = `${Math.max(0, vis).toFixed(2)} ${(2 * L + 10).toFixed(2)}`;
        p.style.strokeDashoffset = (-tl).toFixed(2);
      }
    }
  },
  /** A light swipe while each train travels, a pop on its landing (pitch rising), a whoosh when the rows run off. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.75);
    let k = 0;
    for (const u of section.units) {
      if (u.item < 0 || !u.revealed || !Number.isFinite(u.at)) continue;
      const pan = host.pan(u);
      const from = section.dir === 'ltr' ? 0.5 : -0.5;
      out.push({ t: Math.max(0.6, u.at - params.travel), until: Math.max(0.6, u.at), kind: 'swipe', weight: 0.18, pan: (pan + from) / 2 });
      out.push({ t: Math.max(0.6, u.at), kind: 'pop', weight: u.tags.hero || u.emphasis ? 0.5 : 0.32, pitch: Math.min(7, k++), pan });
    }
    const ex = exitWindow(section);
    if (ex) {
      const end = ex.t0 + Math.min(params.exit, ex.t1 - ex.t0);
      const t0 = Math.max(0.6, ex.t0);
      if (t0 < end) out.push({ t: t0, until: end, kind: 'whoosh', weight: 0.35, pan: section.dir === 'ltr' ? -0.3 : 0.3 });
    }
    return out;
  },
});
