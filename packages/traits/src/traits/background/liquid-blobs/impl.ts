import { defineBackground, type Layer } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const N = 5;
const els = new WeakMap<Layer, HTMLElement[]>();

export default defineBackground({
  meta,
  mount({ host, layer }) {
    const root = host.el('div', 'liquid-blobs', layer.under);
    els.set(layer, Array.from({ length: N }, () => host.el('div', 'blob', root)));
  },
  /** Every blob's box and gradient are rewritten each frame from t (and the beat pulse) alone. */
  frame({ host, layer, params }, t) {
    const short = Math.min(host.W, host.H);
    const s = layer.sections.findLast((x) => t >= (x.window?.t0 ?? -Infinity)) ?? layer.sections[0]!;
    const p = Math.max(0, Math.min(1, s.pulse(t)));
    const v = t * params.speed;
    els.get(layer)!.forEach((el, i) => {
      const x = host.W * (0.5 + 0.36 * Math.sin(v * (0.13 + 0.031 * i) + i * 2.1));
      const y = host.H * (0.5 + 0.38 * Math.cos(v * (0.11 + 0.027 * i) + i * 1.3));
      const r = params.size * short * (0.42 + 0.1 * Math.sin(v * 0.37 + i * 1.7)) * (1 + 0.03 * p);
      const c = host.accent(i, layer);
      Object.assign(el.style, {
        left: `${(x - r).toFixed(1)}px`,
        top: `${(y - r).toFixed(1)}px`,
        width: `${(2 * r).toFixed(1)}px`,
        height: `${(2 * r).toFixed(1)}px`,
        background: `radial-gradient(circle closest-side, ${rgba(c, params.strength * 0.6)} 0%, ${rgba(c, params.strength * 0.28)} 45%, ${rgba(c, 0)} 100%)`,
      });
    });
  },
});
