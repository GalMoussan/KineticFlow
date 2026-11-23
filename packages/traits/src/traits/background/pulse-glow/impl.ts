import { defineBackground, type Layer, type Section } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const els = new WeakMap<Layer, HTMLElement>();

/** The layer's section on screen at t (its hold, or the incoming one during a move); the first one before that. */
const current = (layer: Layer, t: number): Section =>
  layer.sections.findLast((s) => t >= (s.window?.t0 ?? -Infinity)) ?? layer.sections[0]!;

const pct = (v: number) => `${v.toFixed(2)}%`;

export default defineBackground({
  meta,
  mount({ host, layer }) {
    els.set(layer, host.el('div', 'pulse-glow', layer.under));
  },
  /** Every gradient stop is rewritten each frame from the pulse at t. */
  frame({ host, layer, params }, t) {
    const el = els.get(layer)!;
    const p = Math.max(0, Math.min(1, current(layer, t).pulse(t)));
    const bg = layer.palette.bg;
    const a0 = host.accent(0, layer);
    const a1 = host.accent(2, layer);
    const g = params.glow;
    const layers = [
      `radial-gradient(ellipse ${pct(70 + 30 * p)} ${pct(32 + 18 * p)} at 50% 100%, ${rgba(a0, g * (0.3 + 0.45 * p))}, ${rgba(a0, 0)} 100%)`,
      `radial-gradient(circle at 50% 45%, ${rgba(a1, g * (0.1 + 0.22 * p))}, ${rgba(a1, 0)} ${pct(38 + 14 * p)})`,
    ];
    if (params.ring) {
      // the cone: a thin bright ring that contracts on the hit and relaxes outwards as the pulse decays
      const r = 46 - 10 * p;
      const a = params.ring * (0.08 + 0.3 * p);
      layers.unshift(
        `radial-gradient(circle at 50% 45%, ${rgba(a0, 0)} ${pct(r - 1.2)}, ${rgba(a0, a)} ${pct(r)}, ${rgba(a0, 0)} ${pct(r + 1.2)})`,
      );
    }
    el.style.background = `${layers.join(', ')}, ${bg}`;
  },
});
