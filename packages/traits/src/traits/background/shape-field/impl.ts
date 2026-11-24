import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { meta } from './meta.ts';

const MAX = 12;
const els = new WeakMap<Layer, HTMLElement[]>();

export default defineBackground({
  meta,
  mount({ host, layer }) {
    const root = host.el('div', 'shape-field', layer.under);
    els.set(layer, Array.from({ length: MAX }, () => host.el('div', 'sf', root)));
  },
  /**
   * Shape i of layer L: kind, edge slot, size and colour from `hash(L, i)`; position drifts and the shape turns with
   * t, size breathes with the pulse. Every property of every shape is rewritten each frame.
   */
  frame({ host, layer, params }, t) {
    const short = Math.min(host.W, host.H);
    const s = layer.sections.findLast((x) => t >= (x.window?.t0 ?? -Infinity)) ?? layer.sections[0]!;
    const p = Math.max(0, Math.min(1, s.pulse(t)));
    els.get(layer)!.forEach((el, i) => {
      if (i >= params.count) {
        el.style.display = 'none';
        return;
      }
      const h = (k: number) => hash(layer.index * 97 + i * 13 + k);
      const kind = Math.floor(h(1) * 3); // circle, square, half-disc
      // around the frame: a point on a ring at 44–50 % of the frame from the centre, pushed out to the edges
      const a = (2 * Math.PI * (i + h(2) * 0.6)) / params.count;
      const x = host.W / 2 + Math.cos(a) * host.W * (0.42 + 0.08 * h(3)) + 0.02 * short * Math.sin(t * 0.5 + i);
      const y = host.H / 2 + Math.sin(a) * host.H * (0.42 + 0.08 * h(4)) + 0.02 * short * Math.cos(t * 0.4 + i * 1.7);
      const d = short * (0.12 + 0.16 * h(5)) * (1 + 0.05 * p);
      const rot = (h(6) - 0.5) * 60 + t * (h(7) - 0.5) * 24;
      const c = host.accent(i, layer);
      Object.assign(el.style, {
        display: 'block',
        width: `${d.toFixed(1)}px`,
        height: `${(kind === 2 ? d / 2 : d).toFixed(1)}px`,
        transform: `translate(${(x - d / 2).toFixed(1)}px, ${(y - d / 2).toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`,
        border: `${(0.05 * d).toFixed(1)}px solid ${c}`,
        background: i % 3 === 0 ? c : 'transparent',
        borderRadius: kind === 0 ? '50%' : kind === 2 ? `${(d / 2).toFixed(1)}px ${(d / 2).toFixed(1)}px 0 0` : '0',
        opacity: (params.strength * (i % 3 === 0 ? 0.55 : 1)).toFixed(3),
      });
    });
  },
});
