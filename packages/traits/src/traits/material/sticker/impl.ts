import { defineMaterial, type Unit } from '../../../contract.ts';
import { mixHex } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** Ring directions of the rim (enough that no gap shows between offsets at rim widths ≤ 0.2 em). */
const RING = 24;
/** Each unit's rim + drop shadow layers (from fingerprinted unit fields, palette and params). */
const shadows = new WeakMap<Unit, string>();

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = host.accent(u.item + section.index, section);
  },
  mount({ section, params }) {
    const rim = section.palette.text;
    const drop = mixHex(section.palette.bg, '#000000', 0.55);
    for (const u of section.units) {
      if (u.item < 0 || !u.text || !u.font.size) continue;
      const r = params.rim * u.font.size;
      const layers: string[] = [];
      for (let i = 0; i < RING; i++) {
        const a = (i / RING) * 2 * Math.PI;
        layers.push(`${(r * Math.cos(a)).toFixed(2)}px ${(r * Math.sin(a)).toFixed(2)}px 0 ${rim}`);
      }
      // the drop shadow sits under the rim, offset down-and-away like a sticker lifted off the sheet
      const d = params.drop * u.font.size;
      if (d > 0) {
        for (const k of [0.5, 1]) layers.push(`${(d * 0.35 * k).toFixed(2)}px ${(r + d * k).toFixed(2)}px 0 ${drop}`);
      }
      shadows.set(u, layers.join(', '));
    }
  },
  frame({ section }) {
    for (const u of section.units) {
      const tilt = (u.data.layout as { tilt?: number } | undefined)?.tilt;
      if (tilt) u.ch.rot += tilt;
      const sh = shadows.get(u);
      if (!sh) continue;
      if (u.parts.length) for (const p of u.parts) p.ch.shadow = p.ch.shadow ? `${p.ch.shadow}, ${sh}` : sh;
      else u.ch.shadow = u.ch.shadow ? `${u.ch.shadow}, ${sh}` : sh;
    }
  },
});
