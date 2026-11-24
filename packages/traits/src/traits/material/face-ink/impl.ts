import { defineMaterial } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { contrastOf, readableOn } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

export default defineMaterial({
  meta,
  prepare({ section, params }, u) {
    if (u.item < 0 || !u.text) return;
    const P = section.palette;
    const surface = (u.data.layout as { surface?: string } | undefined)?.surface ?? P.bg;
    let color = readableOn(surface, [P.text, '#FFFFFF', '#111111']);
    if (u.tags.hero || u.tags.ordinal >= 0 || u.tags.numeric) {
      const shift = u.tags.hero ? 0 : u.tags.numeric ? 1 : 2 + u.tags.ordinal;
      const n = P.accents.length;
      const ranked = P.accents
        .map((a, i) => ({ a, c: contrastOf(a, surface), k: (((i - shift) % n) + n) % n }))
        .filter((x) => x.c >= params.min)
        .sort((x, y) => x.k - y.k);
      if (ranked.length) color = ranked[0]!.a;
    }
    u.color = color;
    if (params.shadow > 0 && u.font.size) {
      const o = (params.shadow * u.font.size).toFixed(2);
      u.data.material = { shadow: `${o}px ${o}px 0 ${rgba(color, 0.2)}` };
    }
  },
  /** The printed shadow is a static `shadow` layer (the host rewrites text-shadow every frame). */
  frame({ section }) {
    for (const u of section.units) {
      const m = u.data.material as { shadow: string } | undefined;
      if (!m) continue;
      if (u.parts.length) for (const p of u.parts) p.ch.shadow = p.ch.shadow ? `${p.ch.shadow}, ${m.shadow}` : m.shadow;
      else u.ch.shadow = u.ch.shadow ? `${u.ch.shadow}, ${m.shadow}` : m.shadow;
    }
  },
});
