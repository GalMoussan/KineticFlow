import { clamp01, smooth } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { mixHex } from '../../../lib/neon.ts';
import { moduleGrid } from '../../../lib/modules.ts';
import { meta } from './meta.ts';

const els = new WeakMap<Layer, HTMLElement[]>();

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const p = layer.palette;
    const fill = host.el('div', 'mg-fill', layer.under, { background: p.bg });
    if (params.dots > 0) {
      const dot = mixHex(p.bg, p.text, 0.12 * params.dots);
      const step = Math.round(Math.min(host.W, host.H) / 36);
      Object.assign(fill.style, {
        backgroundImage: `radial-gradient(circle, ${dot} 1.6px, transparent 2px)`,
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${(host.safe.cx % step).toFixed(1)}px ${(host.safe.cy % step).toFixed(1)}px`,
      });
    }
    const out = [fill];
    if (params.lines > 0) {
      const G = moduleGrid(host, host.zoomRange(layer.sections[0]!)[1]);
      const hair = mixHex(p.bg, p.text, 0.1 * params.lines);
      const mark = mixHex(p.bg, p.text, 0.42 * params.lines);
      const xs: number[] = [];
      const ys: number[] = [];
      for (let c = 0; c <= G.cols; c++) xs.push(G.x0 + c * (G.cw + G.g) - (c ? G.g / 2 : 0) - (c === G.cols ? G.g / 2 : 0));
      for (let r = 0; r <= G.rows; r++) ys.push(G.y0 + r * (G.rh + G.g) - (r ? G.g / 2 : 0) - (r === G.rows ? G.g / 2 : 0));
      const f = (v: number) => v.toFixed(1);
      const lines = [
        ...xs.map((x) => `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${host.H}"/>`),
        ...ys.map((y) => `<line x1="0" y1="${f(y)}" x2="${host.W}" y2="${f(y)}"/>`),
      ].join('');
      const a = Math.max(6, G.g * 0.6);
      const crosses = xs
        .flatMap((x) => ys.map((y) => `M${f(x - a)} ${f(y)}H${f(x + a)}M${f(x)} ${f(y - a)}V${f(y + a)}`))
        .join('');
      const svg = host.el('div', 'mg-lines', null);
      svg.innerHTML =
        `<svg width="${host.W}" height="${host.H}" viewBox="0 0 ${host.W} ${host.H}" style="display:block">` +
        `<g stroke="${hair}" stroke-width="1.5" shape-rendering="crispEdges">${lines}</g>` +
        `<path d="${crosses}" stroke="${mark}" stroke-width="2" fill="none"/></svg>`;
      layer.back.prepend(svg);
      out.push(svg);
    }
    els.set(layer, out);
  },
  /** Opaque except inside the layer's incoming window, where it fades in over the outgoing layer. */
  frame({ layer }, t) {
    const w = layer.sections[0]!.window;
    const k = w && w.t1 > w.t0 ? smooth(clamp01((t - w.t0) / (w.t1 - w.t0))) : 1;
    for (const e of els.get(layer) ?? []) e.style.opacity = k >= 1 ? '1' : k.toFixed(3);
  },
});
