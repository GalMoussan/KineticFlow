/**
 * Extruded type. `prepare` picks bold palette fills per tag and the extrusion's side/back shades (kept in
 * `unit.data.material`); `frame` projects the depth (`depth` em along world z) through the layer's rig at t and
 * writes the stacked shadows onto the inner element, or onto each part of a split unit, solved through the
 * element's full transform (outer · inner · part) so the extrusion is exact on screen.
 */
import { defineMaterial } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { chMat, extrusion, mix, mul2, project, rig } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

interface Shade {
  side: string;
  back: string;
}

/** Shadow colour ramps, side → back, by length (pure; memoised across frames). */
const ramps = new Map<string, string[]>();
function ramp(s: Shade, n: number): string[] {
  const key = `${s.side}${s.back}${n}`;
  let r = ramps.get(key);
  if (!r) {
    r = Array.from({ length: n }, (_, i) => mix(s.side, s.back, n > 1 ? i / (n - 1) : 0));
    ramps.set(key, r);
  }
  return r;
}

/** Appends extra text-shadow layers to a channel's existing ones. */
const append = (prev: string, ext: string) => (ext ? (prev ? `${prev}, ${ext}` : ext) : prev);

export default defineMaterial({
  meta,
  prepare({ host, section, params }, u) {
    const P = section.palette;
    if (!u.text) return;
    const front = u.tags.hero
      ? host.accent(1, section)
      : u.tags.numeric
        ? host.accent(2, section)
        : u.tags.ordinal >= 0
          ? host.accent([0, 2, 3][u.tags.ordinal % 3]!, section)
          : P.text;
    u.color = front;
    const side = front === P.text ? host.accent(0, section) : mix(front, '#000000', 0.32);
    const shade: Shade = { side, back: mix(side, mix(P.bg, '#000000', 0.55), params.shade) };
    u.data.material = shade;
  },
  frame({ layer, section, params }, t) {
    const q = rig(layer).proj?.(t);
    const soft = rgba('#000000', params.soft);
    for (const u of section.units) {
      const shade = u.data.material as Shade | undefined;
      if (!shade || !u.inner || !u.font.size) continue;
      const depth = params.depth * u.font.size;
      const d: [number, number] = q ? project(q, [0, 0, depth]) : [0.32 * depth, 0.26 * depth];
      const len = Math.hypot(d[0], d[1]);
      const cols = ramp(shade, Math.max(2, Math.min(Math.round(params.steps), Math.ceil(len / 1.1))));
      const blur = 2 + 0.3 * len;
      const c = u.ch;
      const total = mul2(chMat(c.rot, c.skx, c.sx, c.sy), chMat(c.irot, c.iskx, c.isx, c.isy));
      const sh = params.soft > 0 ? soft : null;
      if (u.parts.length) {
        for (const p of u.parts) {
          const m = mul2(total, chMat(p.ch.rot, p.ch.skx, p.ch.sx, p.ch.sy));
          p.ch.shadow = append(p.ch.shadow, extrusion(d, m, cols, sh, blur));
        }
      } else c.shadow = append(c.shadow, extrusion(d, total, cols, sh, blur));
    }
  },
});
