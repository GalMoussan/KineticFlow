import type { ResolvedPalette, SoundCue } from '@reel/core';
import { clamp01, lerp } from '@reel/runtime';
import { defineMaterial, type Host, type Section, type Unit } from '../../../contract.ts';
import { glossFrame, glossMount, sheenBand, type Gloss } from '../../../lib/gloss.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** Seconds a sheen band takes across its word; hairline rim directions. */
const SWEEP = 0.75;
const RIM = 12;

interface Coat {
  g: Gloss;
  /** The metallic gradient (frame px), fixed per unit. */
  base: string;
  /** First sheen sweep. */
  t0: number;
  /** Sweep runs from the end side (RTL text). */
  rev: boolean;
}
const coats = new WeakMap<Section, Coat[]>();
const shadows = new WeakMap<Unit, string>();

const W = '#FFFFFF';
const K = '#000000';

/** Accent that tints a unit's steel: hero accent 0, emphasis accents 1/2 in turn, numbers accent 1, else none. */
function tintOf(host: Host, s: Section, u: Unit): string {
  if (u.tags.hero) return host.accent(0, s);
  if (u.tags.ordinal >= 0) return host.accent(1 + (u.tags.ordinal % 2), s);
  if (u.tags.numeric) return host.accent(1, s);
  return s.palette.text;
}

/** Gradient stops (position in the ink box 0..1, colour): steel blended towards 80s horizon chrome by `h`. */
function stops(host: Host, s: Section, tint: string, h: number): [number, string][] {
  const { bg, text } = s.palette as ResolvedPalette;
  const [a0, a1, a2] = [0, 1, 2].map((i) => host.accent(i, s)) as [string, string, string];
  const steel: [number, string][] = [
    [0, mixHex(text, tint, 0.25)],
    [0.22, mixHex(text, bg, 0.38)],
    [0.45, mixHex(text, bg, 0.72)],
    [0.5, mixHex(bg, K, 0.4)],
    [0.53, mixHex(bg, tint, 0.35)],
    [0.7, mixHex(tint, text, 0.55)],
    [0.88, W],
    [1, mixHex(text, bg, 0.3)],
  ];
  const horizon: [number, string][] = [
    [0, mixHex(a2, K, 0.6)],
    [0.2, mixHex(a2, K, 0.25)],
    [0.46, mixHex(a2, W, 0.6)],
    [0.5, W],
    [0.52, mixHex(bg, K, 0.25)],
    [0.72, a0],
    [0.9, a1],
    [1, mixHex(a1, W, 0.4)],
  ];
  return steel.map(([p, c], i) => [lerp(p, horizon[i]![0], h), mixHex(c, horizon[i]![1], h)]);
}

export default defineMaterial({
  meta,
  prepare({ host, section, params }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    // the fill sits on a clone above the text; the text's own colour only shows where the overlay cannot reach
    u.color = stops(host, section, tintOf(host, section, u), params.horizon)[3]![1];
  },
  mount({ host, section, params }) {
    const list: Coat[] = [];
    const rim = mixHex(section.palette.bg, K, 0.55);
    const ext = mixHex(host.accent(0, section), K, 0.5);
    const glow = rgba(host.accent(0, section), 0.5);
    for (const u of section.units) {
      if (u.item < 0) continue;
      const g = glossMount(host, u);
      if (!g) continue;
      const S = u.font.size;
      const y = (p: number) => g.ink.y + p * g.ink.h;
      const st = stops(host, section, tintOf(host, section, u), params.horizon);
      const base = `linear-gradient(180deg, ${st.map(([p, c]) => `${c} ${y(p).toFixed(1)}px`).join(', ')})`;
      list.push({ g, base, t0: u.at + 0.05 + 0.1 * Math.max(0, u.tags.line), rev: section.dir === 'rtl' && !u.ltr });
      // under the fill: hairline rim, extrusion down-and-right, accent glow (first listed paints on top)
      const layers: string[] = [];
      const r = Math.max(1, 0.014 * S);
      for (let i = 0; i < RIM; i++) {
        const a = (i / RIM) * 2 * Math.PI;
        layers.push(`${(r * Math.cos(a)).toFixed(2)}px ${(r * Math.sin(a)).toFixed(2)}px 0 ${rim}`);
      }
      const d = params.depth * S;
      const n = Math.min(24, Math.ceil(d / 1.5));
      for (let k = 1; k <= n; k++) layers.push(`${((0.35 * k * d) / n).toFixed(2)}px ${((k * d) / n + r).toFixed(2)}px 0 ${mixHex(ext, K, (0.35 * k) / n)}`);
      if (params.glow > 0) layers.push(`0 0 ${(params.glow * S).toFixed(1)}px ${glow}`);
      shadows.set(u, layers.join(', '));
    }
    coats.set(section, list);
  },
  frame({ section, params }, t) {
    for (const u of section.units) {
      const sh = shadows.get(u);
      if (!sh) continue;
      if (u.parts.length) for (const p of u.parts) p.ch.shadow = p.ch.shadow ? `${p.ch.shadow}, ${sh}` : sh;
      else u.ch.shadow = u.ch.shadow ? `${u.ch.shadow}, ${sh}` : sh;
    }
    for (const c of coats.get(section)!) {
      const layers = [{ image: c.base }];
      const k = t - c.t0;
      if (params.sheen > 0 && k >= 0) {
        const q = (k % params.period) / SWEEP;
        if (q < 1) {
          const { ink, frame } = c.g;
          const p = c.rev ? 1 - q : q;
          const x = (ink.x + lerp(-0.35, 1.35, p) * ink.w) / frame.w;
          const w = (0.24 * ink.w) / frame.w;
          const a = params.sheen * clamp01(Math.sin(Math.PI * q) * 1.6);
          // a hard specular core inside a soft halo
          layers.unshift({ image: sheenBand(x, w * 0.3, a) }, { image: sheenBand(x, w, a * 0.5) });
        }
      }
      glossFrame(c.g, layers);
    }
  },
  /** One shimmer per section as the sheen first crosses its key word (the hero, else the largest word). */
  sounds({ host, section, params }) {
    if (params.sheen <= 0) return [];
    const list = coats.get(section)!;
    const key = list.find((c) => c.g.u.tags.hero) ?? [...list].sort((a, b) => b.g.u.font.size - a.g.u.font.size)[0];
    if (!key) return [];
    return [{ t: key.t0 + 0.3 * SWEEP, kind: 'shimmer', weight: 0.35, pan: host.pan(key.g.u) } satisfies SoundCue];
  },
});
