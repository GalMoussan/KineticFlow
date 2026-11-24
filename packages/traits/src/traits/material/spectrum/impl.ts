import { defineMaterial, type Part, type Section } from '../../../contract.ts';
import { spectrumColor, spectrumPos } from '../../../lib/eq.ts';
import { meta } from './meta.ts';

/** Accent of every letter, from its spectrum position (derived from fingerprinted geometry and the palette). */
const colours = new WeakMap<Section, Map<Part, string>>();

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item >= 0 && u.kind !== 'logos') u.color = host.accent(0, section);
  },
  mount({ host, section }) {
    const out = new Map<Part, string>();
    for (const [p, f] of spectrumPos(section)) out.set(p, spectrumColor(host, section, f));
    colours.set(section, out);
  },
  frame({ section, params }, t) {
    const map = colours.get(section)!;
    const pulse = Math.max(0, Math.min(1, section.pulse(t)));
    for (const u of section.units) {
      if (u.item < 0) continue;
      // whole pixels: fractional shadow blurs raster differently with the GPU tile state (as audio-reactive's split)
      const g = Math.round(params.glow * 0.07 * u.font.size * pulse);
      for (const p of u.parts) {
        const col = map.get(p);
        if (col) p.ch.color = col;
        if (g >= 1) {
          p.ch.glow += g;
          p.ch.glowColor = col ?? null;
        }
      }
    }
  },
});
