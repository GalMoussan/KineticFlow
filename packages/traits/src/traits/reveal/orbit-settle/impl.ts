/**
 * Orbit settle (see meta). A glyph's rest angle is the bearing of its row plus its measured distance along the
 * chord, in radians of arc. The last 38% of the entrance blends that point back to the measured centre and the
 * tangent back to 0, so the landing is the identity. `e >= 1` does not touch the channels at all.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { partCentre, ride, type Pt } from '../../../lib/pathtext.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import type { OrbitRow, OrbitSection, OrbitUnit } from '../../layout/orbit-ring/impl.ts';
import { meta } from './meta.ts';

interface Item {
  ch: { tx: number; ty: number; rot: number };
  home: Pt;
  row: number;
}

const riders = new WeakMap<Unit, Item[]>();
const rings = new WeakMap<Section, Map<number, SVGCircleElement>>();

const rowOf = (u: Unit) => (u.data.layout as OrbitUnit | undefined)?.row;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item < 0) return;
    if (u.text && u.kind !== 'logos') u.split = 'grapheme';
    else u.origin = '50% 50%';
  },
  mount({ section }) {
    const map = new Map<number, SVGCircleElement>();
    for (const u of section.units) {
      if (u.deco === 'ring') {
        const index = (u.data.reveal as { index: number } | undefined)?.index;
        const circle = u.inner?.querySelector('circle');
        if (circle && index !== undefined) map.set(index, circle);
        continue;
      }
      const row = rowOf(u);
      if (row === undefined || u.item < 0 || !u.revealed) continue;
      const items: Item[] = u.parts.length
        ? u.parts.map((p) => ({ ch: p.ch, home: partCentre(u, p), row }))
        : [{ ch: u.ch, home: { x: u.box.x + u.box.w / 2, y: u.box.y + u.box.h / 2 }, row }];
      riders.set(u, items);
    }
    rings.set(section, map);
  },
  frame({ section, params }, t) {
    const d = section.data.layout as OrbitSection;
    const ex = exitWindow(section);
    const ke = ex && t >= ex.t0 ? clamp01((t - ex.t0) / Math.min(params.exit, ex.t1 - ex.t0)) : 0;
    const exiting = ke > 0;
    const sweep = params.sweep * Math.PI * 2;
    const shown = new Map<number, number>();
    for (const u of section.units) {
      const items = riders.get(u);
      if (!items) continue;
      const st = u.at - params.travel;
      u.ch.visible &&= t >= st;
      if (t < st) continue;
      const enter = section.motion.enter(clamp01((t - st) / params.travel));
      const e = exiting ? 1 - section.motion.exit(ke) : enter;
      const rowDraw = shown.get(items[0]!.row) ?? 0;
      shown.set(items[0]!.row, Math.max(rowDraw, e));
      if (e >= 1 && !exiting) continue;
      const orbitK = Math.min(1, e / 0.62);
      const settle = e <= 0.62 ? 0 : (e - 0.62) / 0.38;
      for (const it of items) {
        const ring = d.rows[it.row];
        if (!ring) continue;
        const spin = (ring.y < d.cy ? 1 : -1) * (section.dir === 'rtl' ? -1 : 1);
        const rest = Math.atan2(ring.y - d.cy, 0) + (it.home.x - ring.cx) / ring.r;
        const theta = rest + (1 - orbitK) * sweep * spin;
        const ang = (theta + Math.PI / 2) * (1 - settle);
        ride(it.ch, it.home, 0, {
          x: d.cx + ring.r * Math.cos(theta) * (1 - settle) + it.home.x * settle,
          y: d.cy + ring.r * Math.sin(theta) * (1 - settle) + it.home.y * settle,
          a: ang,
        });
      }
    }
    const map = rings.get(section);
    if (!map) return;
    for (const [i, circle] of map) {
      const ring: OrbitRow | undefined = d.rows[i];
      if (!ring) continue;
      const circ = 2 * Math.PI * ring.r;
      const draw = shown.get(i) ?? (exiting ? 1 - section.motion.exit(ke) : 0);
      circle.style.strokeDasharray = `${circ.toFixed(2)} ${(circ + 2).toFixed(2)}`;
      circle.style.strokeDashoffset = (circ * (1 - Math.max(0, Math.min(1, draw)))).toFixed(2);
    }
  },
  /** A swipe while each line is still on the ring, a pop as it lands, a whoosh if the page leaves. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.7);
    const rows = new Set<number>();
    for (const u of section.units) {
      if (u.item < 0 || !Number.isFinite(u.at)) continue;
      const row = rowOf(u);
      const pan = host.pan(u);
      const st = Math.max(0.6, u.at - params.travel);
      if (row !== undefined && !rows.has(row)) {
        rows.add(row);
        out.push({ t: st, until: Math.max(st, u.at), kind: 'swipe', weight: 0.22, pan });
      }
      out.push({ t: Math.max(0.6, u.at), kind: 'pop', weight: u.emphasis || u.tags.hero ? 0.46 : 0.3, pan });
    }
    const ex = exitWindow(section);
    if (ex) out.push({ t: Math.max(0.6, ex.t0), until: ex.t0 + Math.min(params.exit, ex.t1 - ex.t0), kind: 'whoosh', weight: 0.3 });
    return out;
  },
});
