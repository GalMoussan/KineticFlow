import { defineBackground, type Layer } from '../../../contract.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** Seconds for the rolling band to cross the screen once. */
const ROLL = 7;
const bands = new WeakMap<Layer, HTMLElement>();

export default defineBackground({
  meta,
  /** Static gradients are set once; only the rolling band moves (its transform is rewritten every frame). */
  mount({ host, layer, params }) {
    const { W, H } = host;
    const bg = layer.palette.bg;
    const a0 = host.accent(0, layer);
    const deep = mixHex(bg, '#000000', 0.75);
    const base = [
      `radial-gradient(ellipse 75% 60% at 50% 46%, ${rgba(a0, 0.16 * params.bloom)}, ${rgba(a0, 0)} 100%)`,
      `radial-gradient(ellipse 95% 85% at 50% 50%, ${rgba(deep, 0)} 55%, ${rgba(deep, 0.85 * params.vignette)} 100%)`,
    ];
    host.el('div', 'screen-fill', layer.under, { background: `${base.join(', ')}, ${bg}` });
    if (params.grid) {
      const g = Math.round(Math.min(W, H) / 14);
      const line = rgba(a0, 0.16 * params.grid);
      host.el('div', 'screen-fill', layer.under, {
        'background-image': `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
        'background-size': `${g}px ${g}px`,
        'background-position': `${(W / 2) % g}px ${(H / 2) % g}px`,
      });
    }
    if (params.sweep) {
      bands.set(
        layer,
        host.el('div', 'screen-band', layer.under, {
          height: `${Math.round(0.24 * H)}px`,
          background: `linear-gradient(to bottom, ${rgba(a0, 0)}, ${rgba(a0, 0.07 * params.sweep)} 70%, ${rgba(a0, 0.12 * params.sweep)} 96%, ${rgba(a0, 0)})`,
        }),
      );
    }
    if (params.lines) {
      const pitch = Math.max(3, Math.round(H / 480));
      const dark = rgba(deep, 0.32 * params.lines);
      host.el('div', 'screen-fill', layer.over, {
        background: `repeating-linear-gradient(to bottom, ${dark} 0 1px, transparent 1px ${pitch}px)`,
      });
    }
  },
  frame({ host, layer }, t) {
    const band = bands.get(layer);
    if (!band) return;
    const k = (((t / ROLL) % 1) + 1) % 1;
    band.style.transform = `translateY(${((k * 1.3 - 0.27) * host.H).toFixed(1)}px)`;
  },
});
