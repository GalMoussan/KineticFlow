/**
 * Timer ring (see meta). One static field + SVG built in `setup` (the dial, the track, the ring and its head);
 * `frame` rewrites the ring's dash, width and the head's position from t: the section of the layer that owns t
 * drains the ring from its `in` to its `out` (full during its incoming window).
 */
import { clamp01 } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

interface Ring {
  arc: SVGCircleElement;
  head: SVGCircleElement;
  halo: SVGCircleElement;
  cx: number;
  cy: number;
  R: number;
  w: number;
}
const rings = new WeakMap<Layer, Ring>();
const f2 = (v: number) => v.toFixed(2);

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const P = layer.palette;
    const { safe, W, H } = host;
    const min = Math.min(safe.w, safe.h);
    const R = params.radius * min;
    const w = params.width * min;
    const cx = safe.cx;
    const cy = safe.cy;
    const glow = host.accent(1, layer);
    const root = host.el('div', 'timer-ring', layer.under, {
      background: `radial-gradient(circle at ${f2((cx / W) * 100)}% ${f2((cy / H) * 100)}%, ${rgba(glow, 0.16 * params.glow)} 0%, ${rgba(glow, 0)} ${f2((R * 1.6 * 100) / Math.max(W, H))}%), ${P.bg}`,
    });
    const ticks: string[] = [];
    if (params.ticks > 0) {
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * 2 * Math.PI;
        const major = i % 5 === 0;
        const r0 = R + w * 1.25;
        const r1 = r0 + (major ? 0.075 : 0.035) * R;
        const [s, c] = [Math.sin(a), Math.cos(a)];
        ticks.push(
          `<line x1="${f2(cx + r0 * s)}" y1="${f2(cy - r0 * c)}" x2="${f2(cx + r1 * s)}" y2="${f2(cy - r1 * c)}" ` +
            `stroke="${rgba(P.text, params.ticks * (major ? 1 : 0.55))}" stroke-width="${f2(Math.max(2, (major ? 0.009 : 0.005) * R))}"/>`,
        );
      }
    }
    root.innerHTML =
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${ticks.join('')}` +
      `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(R)}" fill="none" stroke="${rgba(glow, 0.2)}" stroke-width="${f2(w)}"/>` +
      `<circle class="ring" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(R)}" fill="none" stroke="${glow}" stroke-linecap="round" transform="rotate(-90 ${f2(cx)} ${f2(cy)})"/>` +
      `<circle class="halo" fill="${rgba(host.accent(0, layer), 0.25)}"/><circle class="head" fill="${host.accent(0, layer)}"/></svg>`;
    rings.set(layer, {
      arc: root.querySelector<SVGCircleElement>('.ring')!,
      head: root.querySelector<SVGCircleElement>('.head')!,
      halo: root.querySelector<SVGCircleElement>('.halo')!,
      cx,
      cy,
      R,
      w,
    });
  },
  frame({ host, layer, params }, t) {
    const g = rings.get(layer);
    if (!g) return;
    const s = layer.sections.find((x) => t < x.timing.out) ?? layer.sections.at(-1)!;
    const k = clamp01((t - s.timing.in) / Math.max(1e-6, s.timing.out - s.timing.in));
    const C = 2 * Math.PI * g.R;
    const w = g.w * (1 + 0.25 * params.beat * host.beatPulse(t, 8));
    g.arc.setAttribute('stroke-width', f2(w));
    g.arc.setAttribute('stroke-dasharray', `${f2((1 - k) * C)} ${f2(C + w)}`);
    g.arc.setAttribute('stroke-dashoffset', f2(-k * C));
    g.arc.setAttribute('visibility', k < 1 ? 'visible' : 'hidden');
    const a = k * 2 * Math.PI;
    const x = g.cx + g.R * Math.sin(a);
    const y = g.cy - g.R * Math.cos(a);
    for (const [el, r] of [[g.head, w * 0.8], [g.halo, w * 1.9]] as const) {
      el.setAttribute('cx', f2(x));
      el.setAttribute('cy', f2(y));
      el.setAttribute('r', f2(r));
    }
  },
  /** Pixels follow palette, params, format, the layer's section timings and the beat grid (all fingerprinted). */
  fingerprint: () => 'timer-ring@1',
});
