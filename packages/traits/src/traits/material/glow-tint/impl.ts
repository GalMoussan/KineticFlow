import { defineMaterial } from '../../../contract.ts';
import { meta } from './meta.ts';

/** A soft halo in `color` (any CSS colour: the reveal may have set a part's colour), `r` px wide. */
const halo = (color: string, r: number) =>
  `0 0 ${r.toFixed(2)}px color-mix(in srgb, ${color} 55%, transparent), 0 0 ${(r * 2.6).toFixed(2)}px color-mix(in srgb, ${color} 22%, transparent)`;
const append = (a: string, b: string) => (a ? `${a}, ${b}` : b);

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0) return; // decorations are coloured by their creators
    u.color =
      u.tags.hero || (u.tags.ordinal >= 0 && u.tags.ordinal % 2 === 0)
        ? host.accent(0, section)
        : u.tags.ordinal >= 0
          ? host.accent(2, section)
          : u.tags.numeric
            ? host.accent(1, section)
            : section.palette.text;
  },
  frame({ section, params }) {
    if (!params.glow) return;
    for (const u of section.units) {
      if (!u.text || !u.font.size) continue;
      const r = params.glow * 0.06 * u.font.size;
      const base = u.ch.color ?? u.color;
      if (!u.parts.length) {
        u.ch.shadow = append(u.ch.shadow, halo(base, r));
        continue;
      }
      // a part's text-shadow replaces the inner one, so split units glow per part
      for (const p of u.parts) p.ch.shadow = append(p.ch.shadow, halo(p.ch.color ?? base, r));
    }
  },
});
