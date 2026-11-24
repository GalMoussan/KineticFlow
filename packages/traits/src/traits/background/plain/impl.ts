import { defineBackground } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const { bg, text } = layer.palette;
    const m = Math.min(host.W, host.H);
    const layers: string[] = [];
    const sizes: string[] = [];
    if (params.dots > 0) {
      const p = Math.round(m * 0.045);
      layers.push(`radial-gradient(circle, ${rgba(text, 0.16 * params.dots)} ${(p * 0.09).toFixed(1)}px, ${rgba(text, 0)} ${(p * 0.11).toFixed(1)}px)`);
      sizes.push(`${p}px ${p}px`);
    }
    if (params.grid > 0) {
      const g = Math.round(m / 12);
      const line = rgba(text, 0.12 * params.grid);
      layers.push(`linear-gradient(${line} 2px, ${rgba(text, 0)} 2px)`, `linear-gradient(90deg, ${line} 2px, ${rgba(text, 0)} 2px)`);
      sizes.push(`${g}px ${g}px`, `${g}px ${g}px`);
    }
    const style: Record<string, string> = { background: layers.length ? `${layers.join(', ')}, ${bg}` : bg };
    if (sizes.length) style['background-size'] = sizes.join(', ');
    host.el('div', 'plain-bg', layer.under, style);
  },
});
