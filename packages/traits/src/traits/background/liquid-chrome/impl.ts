import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { blob, neck } from '../../../lib/morph/goo.ts';
import type { Pt } from '../../../lib/morph/geom.ts';
import { draw, put, svgEl } from '../../../lib/morph/page.ts';
import { mixHex } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** Blob anchors (fractions of the frame): corners and the bands above/below the safe area, never mid-frame. */
const SPOTS: readonly Pt[] = [
  [0.08, 0.07],
  [0.93, 0.12],
  [0.0, 0.56],
  [1.0, 0.64],
  [0.2, 0.95],
  [0.84, 0.92],
];
const NS = 'http://www.w3.org/2000/svg';

interface Drop {
  /** User-space radial gradient around the blob (rewritten every frame so the neck shares its shading). */
  grad: SVGRadialGradientElement;
  body: SVGPathElement;
  neck: SVGPathElement;
  light: SVGPathElement;
}
const els = new WeakMap<Layer, { drops: Drop[]; pool: SVGPathElement }>();

export default defineBackground({
  meta,
  mount({ host, layer }) {
    const { bg, text } = layer.palette;
    const a0 = host.accent(0, layer);
    const a1 = host.accent(1, layer);
    host.el('div', 'lc-back', layer.under, {
      background: `radial-gradient(ellipse 90% 70% at 50% 42%, ${mixHex(bg, a0, 0.16)} 0%, ${bg} 55%, ${mixHex(bg, '#000000', 0.45)} 100%)`,
    });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'lc-svg');
    svg.setAttribute('width', String(host.W));
    svg.setAttribute('height', String(host.H));
    layer.under.appendChild(svg);
    host.own(svg);
    const id = `lc${layer.index}`;
    const defs = svgEl('defs', svg);
    const grad = (tag: 'linearGradient' | 'radialGradient', gid: string, attrs: Record<string, string>, st: [number, string][]) => {
      const g = svgEl(tag, defs, { id: gid, ...attrs });
      for (const [o, c] of st) svgEl('stop', g, { offset: String(o), 'stop-color': c });
      return g;
    };
    // mercury: a white specular core, steel body, a dark terminator and a coloured environment rim
    const metal: [number, string][] = [
      [0, '#FFFFFF'],
      [0.1, mixHex(text, '#FFFFFF', 0.4)],
      [0.32, mixHex(text, bg, 0.4)],
      [0.55, mixHex(bg, '#000000', 0.35)],
      [0.7, mixHex(bg, a1, 0.35)],
      [0.84, mixHex(a0, bg, 0.2)],
      [1, mixHex(text, a0, 0.4)],
    ];
    const drops = SPOTS.map((_, i): Drop => {
      const g = grad('radialGradient', `${id}m${i}`, { gradientUnits: 'userSpaceOnUse' }, metal) as SVGRadialGradientElement;
      const fill = `url(#${id}m${i})`;
      return { grad: g, body: svgEl('path', svg, { fill }), neck: svgEl('path', svg, { fill }), light: svgEl('path', svg, { fill: '#FFFFFF' }) };
    });
    grad('linearGradient', `${id}p`, { x1: '0', y1: '0', x2: '0.15', y2: '1' }, [
      [0, '#FFFFFF'],
      [0.12, mixHex(text, a0, 0.3)],
      [0.4, mixHex(bg, '#000000', 0.35)],
      [1, mixHex(a1, bg, 0.6)],
    ]);
    els.set(layer, { drops, pool: svgEl('path', svg, { fill: `url(#${id}p)` }) });
  },
  /** Every path and gradient is rewritten from t and the layer's beat pulse alone. */
  frame({ host, layer, params }, t) {
    const e = els.get(layer)!;
    const id = `lc${layer.index}`;
    const D = Math.min(host.W, host.H);
    const s = layer.sections.findLast((x) => t >= (x.window?.t0 ?? -Infinity)) ?? layer.sections[0]!;
    const pulse = Math.max(0, Math.min(1, s.pulse(t)));
    SPOTS.forEach(([fx, fy], i) => {
      const el = e.drops[i]!;
      const fill = `url(#${id}m${i})`;
      if (i >= params.count) {
        draw(el.body, '', '', 0);
        draw(el.neck, '', '', 0);
        draw(el.light, '', '', 0);
        return;
      }
      const h = (k: number) => hash(layer.index * 53 + i * 11 + k);
      const r = params.size * D * (0.65 + 0.5 * h(1)) * (1 + 0.05 * pulse + 0.04 * Math.sin(t * 0.8 + 6 * h(2)));
      const c: Pt = [fx * host.W + 0.04 * D * Math.sin(t * 0.31 + 6 * h(3)), fy * host.H + 0.04 * D * Math.cos(t * 0.27 + 6 * h(4))];
      // a droplet orbits its blob, pulling away on a metaball neck and merging back
      const a = t * (0.35 + 0.2 * h(5)) * (h(6) < 0.5 ? -1 : 1) + 6 * h(7);
      const dist = r * (1.25 + 0.4 * Math.sin(t * 0.9 + 6 * h(8)));
      const dr = r * (0.22 + 0.1 * h(9));
      const dc: Pt = [c[0] + dist * Math.cos(a), c[1] + dist * Math.sin(a)];
      const ph = t * 1.6 + 6 * h(10);
      // the shading follows the blob: lit from the top left, reaching over its droplet
      put(el.grad, 'cx', (c[0] - 0.3 * r).toFixed(1));
      put(el.grad, 'cy', (c[1] - 0.35 * r).toFixed(1));
      put(el.grad, 'fx', (c[0] - 0.42 * r).toFixed(1));
      put(el.grad, 'fy', (c[1] - 0.48 * r).toFixed(1));
      put(el.grad, 'r', (1.75 * r).toFixed(1));
      draw(el.body, blob(c, r, params.wobble, ph) + blob(dc, dr, params.wobble * 0.6, ph + 1), fill, 1);
      draw(el.neck, neck(c, r, dc, dr), fill, 1);
      draw(el.light, blob([c[0] - 0.38 * r, c[1] - 0.42 * r], 0.2 * r, params.wobble, ph + 2, 1.5, 0.7), '#FFFFFF', 0.55);
    });
    if (params.pool <= 0) {
      draw(e.pool, '', '', 0);
      return;
    }
    const h0 = params.pool * host.H;
    const A = h0 * (0.22 + 0.12 * pulse);
    let d = '';
    for (let x = 0; x <= host.W + 40; x += 40) {
      const y = host.H - h0 + A * (0.6 * Math.sin(x * 0.006 + t * 1.3) + 0.4 * Math.sin(x * 0.014 - t * 0.9));
      d += `${d ? 'L' : 'M'}${x},${y.toFixed(2)}`;
    }
    draw(e.pool, `${d}L${host.W + 40},${host.H}L0,${host.H}Z`, `url(#${id}p)`, 1);
  },
});
