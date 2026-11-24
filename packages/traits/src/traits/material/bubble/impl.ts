import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineMaterial, type Host, type Section, type Unit } from '../../../contract.ts';
import { glossFrame, glossMount, type Gloss } from '../../../lib/gloss.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

interface Coat {
  g: Gloss;
  base: string;
  glint: string;
  /** Fixed iridescent band. A band that moves with t does not repaint reliably under background-clip. */
  iris: string;
}
/** `unit.data.material` of a sparkle: burst time, twinkle phase, spin direction. */
interface Spark {
  at: number;
  ph: number;
  spin: number;
}
const coats = new WeakMap<Section, Coat[]>();
const rims = new WeakMap<Unit, string>();
const RING = 12;
const STAR = 'M50 0 C54 36 64 46 100 50 C64 54 54 64 50 100 C46 64 36 54 0 50 C36 46 46 36 50 0Z';

const candyOf = (host: Host, s: Section, u: Unit): string =>
  u.tags.hero ? host.accent(0, s) : u.tags.ordinal >= 0 ? host.accent(1 + (u.tags.ordinal % 3), s) : u.tags.numeric ? host.accent(1, s) : host.accent(2, s);

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = candyOf(host, section, u);
  },
  setup({ host, section, params }) {
    const n = Math.round(params.sparkles);
    if (!n) return;
    for (const u of [...section.units]) {
      if (u.item < 0 || !u.inkBox || !u.text || !Number.isFinite(u.at) || !(u.tags.hero || u.emphasis)) continue;
      const S = u.font.size;
      const ib = u.inkBox;
      const x0 = u.box.x + u.textAt.x + ib.x;
      const y0 = u.box.y + u.textAt.y + ib.y;
      for (let i = 0; i < n; i++) {
        const h = (k: number) => hash(u.item * 29 + section.index * 13 + i * 5 + k);
        // around the ink: corners and the top edge, outside the letters
        const side = i % 2 ? 1 : 0;
        const x = x0 + (side ? ib.w + 0.08 * S : -0.08 * S) + (h(1) - 0.5) * 0.2 * S;
        const y = y0 + (i === 2 ? -0.15 * S : side ? -0.05 * S : ib.h * (0.5 + 0.4 * h(2)));
        const r = (0.16 + 0.14 * h(3)) * S;
        const col = host.accent(i + 1, section);
        const sp = host.deco(section, {
          deco: 'sparkle',
          box: { x: x - r, y: y - r, w: 2 * r, h: 2 * r },
          html: `<svg width="100%" height="100%" viewBox="-6 -6 112 112" style="display:block;overflow:visible"><path d="${STAR}" fill="#FFFFFF" stroke="${col}" stroke-width="6" stroke-linejoin="round"/></svg>`,
          z: 2,
          at: u.at,
        });
        sp.data.material = { at: u.at + 0.06 * i, ph: h(4) * 6.28, spin: h(5) < 0.5 ? -1 : 1 } satisfies Spark;
      }
    }
  },
  mount({ host, section, params }) {
    const list: Coat[] = [];
    for (const u of section.units) {
      if (u.item < 0) continue;
      const g = glossMount(host, u);
      if (!g) continue;
      const c = candyOf(host, section, u);
      const S = u.font.size;
      const y = (p: number) => (g.ink.y + p * g.ink.h).toFixed(1);
      const base =
        `linear-gradient(180deg, ${mixHex(c, '#FFFFFF', 0.6)} ${y(0)}px, ${mixHex(c, '#FFFFFF', 0.2)} ${y(0.35)}px, ` +
        `${c} ${y(0.62)}px, ${mixHex(c, '#000000', 0.18)} ${y(1)}px)`;
      const gx = ((g.ink.x + 0.3 * g.ink.w) / g.frame.w) * 100;
      const gy = ((g.ink.y + 0.25 * g.ink.h) / g.frame.h) * 100;
      const glint = `radial-gradient(ellipse ${(0.35 * g.ink.w).toFixed(1)}px ${(0.14 * g.ink.h).toFixed(1)}px at ${gx.toFixed(1)}% ${gy.toFixed(1)}%, rgba(255,255,255,0.85), rgba(255,255,255,0))`;
      const a = (0.34 * params.iris).toFixed(3);
      const iris = `linear-gradient(115deg, rgba(150,235,255,0) 8%, rgba(150,235,255,${a}) 36%, rgba(255,170,230,${a}) 64%, rgba(255,214,120,0) 92%)`;
      list.push({ g, base, glint, iris });
      // puffy rims under the fill: white inner rim, candy outer rim, then a short drop
      const layers: string[] = [];
      const r1 = Math.max(1, params.rim * 0.5 * S);
      const r2 = Math.max(1.5, params.rim * S);
      const dark = mixHex(c, '#000000', 0.35);
      for (const [r, col] of [[r1, '#FFFFFF'], [r2, mixHex(c, '#000000', 0.12)]] as const) {
        for (let i = 0; i < RING; i++) {
          const a = (i / RING) * 2 * Math.PI;
          layers.push(`${(r * Math.cos(a)).toFixed(2)}px ${(r * Math.sin(a)).toFixed(2)}px 0 ${col}`);
        }
      }
      const d = params.drop * S;
      const n = Math.min(10, Math.ceil(d / 2));
      for (let k = 1; k <= n; k++) layers.push(`0 ${(r2 + (k * d) / n).toFixed(2)}px 0 ${dark}`);
      layers.push(`0 ${(r2 + d + 0.04 * S).toFixed(1)}px ${(0.12 * S).toFixed(1)}px ${rgba(dark, 0.35)}`);
      rims.set(u, layers.join(', '));
    }
    coats.set(section, list);
  },
  frame({ section, params }, t) {
    for (const u of section.units) {
      const sh = rims.get(u);
      if (sh) {
        if (u.parts.length) for (const p of u.parts) p.ch.shadow = p.ch.shadow ? `${p.ch.shadow}, ${sh}` : sh;
        else u.ch.shadow = u.ch.shadow ? `${u.ch.shadow}, ${sh}` : sh;
      }
      if (u.deco !== 'sparkle') continue;
      const d = u.data.material as Spark;
      const k = clamp01((t - d.at) / 0.4);
      u.ch.visible &&= k > 0;
      if (!u.ch.visible) continue;
      const pop = section.motion.bounce(k, 2);
      const tw = 0.78 + 0.22 * Math.sin(t * 5.5 + d.ph);
      const s = Math.max(0.001, pop * (k < 1 ? 1 : tw));
      u.ch.sx *= s;
      u.ch.sy *= s;
      u.ch.rot += d.spin * ((1 - k) * 120 + 12 * Math.sin(t * 1.3 + d.ph));
      u.ch.opacity *= clamp01(k * 4);
    }
    for (const c of coats.get(section)!) {
      const layers = [{ image: c.glint }, ...(params.iris > 0 ? [{ image: c.iris }] : []), { image: c.base }];
      glossFrame(c.g, layers);
    }
  },
  /** A shimmer as each key word's sparkles burst. */
  sounds({ host, section }) {
    const seen = new Set<number>();
    const out: SoundCue[] = [];
    for (const u of section.units) {
      if (u.deco !== 'sparkle') continue;
      const at = Math.round((u.data.material as Spark).at * 4);
      if (seen.has(at) || at / 4 < 0.6) continue;
      seen.add(at);
      out.push({ t: (u.data.material as Spark).at, kind: 'shimmer', weight: 0.3, pan: host.pan(u) });
    }
    return out;
  },
});
