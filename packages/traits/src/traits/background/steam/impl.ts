import { defineBackground, type Layer } from '../../../contract.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

interface Wisp {
  paths: SVGPathElement[];
  x: number;
  amp: number;
  freq: number;
  ph: number;
  rate: number;
}
const wisps = new WeakMap<Layer, Wisp[]>();
const NS = 'http://www.w3.org/2000/svg';
/** Points per wisp. */
const N = 28;

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const { W, H } = host;
    const { bg, text } = layer.palette;
    const foam = host.accent(2, layer);
    const roast = mixHex(bg, text, 0.28);
    host.el('div', 'steam-bg', layer.under, {
      background:
        `radial-gradient(ellipse 75% 55% at 50% 42%, ${rgba(foam, 0.75)} 0%, ${rgba(foam, 0)} 70%), ` +
        `radial-gradient(ellipse 120% 90% at 50% 50%, ${rgba(roast, 0)} 55%, ${rgba(roast, 0.55)} 100%), ${bg}`,
    });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'steam-svg');
    // the steam fades in above the bottom edge and out towards the top
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', `steam-fade-${layer.index}`);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y1', String(H));
    grad.setAttribute('y2', '0');
    for (const [o, a] of [[0, 0], [0.18, 1], [0.6, 0.7], [1, 0]] as const) {
      const st = document.createElementNS(NS, 'stop');
      st.setAttribute('offset', String(o));
      st.setAttribute('stop-color', '#FFFFFF');
      st.setAttribute('stop-opacity', String(a));
      grad.appendChild(st);
    }
    const defs = document.createElementNS(NS, 'defs');
    defs.appendChild(grad);
    svg.appendChild(defs);
    const list: Wisp[] = [];
    const D = Math.min(W, H);
    const n = Math.round(params.wisps);
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0.5;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('opacity', (params.strength * (0.6 + 0.4 * ((i * 7) % 3) / 2)).toFixed(3));
      const paths = [0.11, 0.045, 0.016].map((wf, j) => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', `url(#steam-fade-${layer.index})`);
        p.setAttribute('stroke-width', (wf * D).toFixed(1));
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-opacity', String([0.16, 0.3, 0.45][j]));
        g.appendChild(p);
        return p;
      });
      svg.appendChild(g);
      list.push({ paths, x: (0.12 + 0.76 * f) * W, amp: D * (0.04 + 0.03 * ((i * 5) % 3)), freq: 2.2 + 0.6 * ((i * 3) % 4), ph: i * 1.7, rate: 0.8 + 0.25 * ((i * 2) % 3) });
    }
    layer.under.appendChild(svg);
    host.own(svg);
    wisps.set(layer, list);
  },
  frame({ host, layer, params }, t) {
    const { H } = host;
    for (const w of wisps.get(layer)!) {
      const rise = t * params.speed * w.rate;
      let d = '';
      for (let k = 0; k <= N; k++) {
        const q = k / N; // 0 at the bottom, 1 at the top
        const y = H * (1.02 - 1.1 * q);
        // curls travel upwards: the phase follows (q − rise); they widen as the steam climbs
        const a = w.amp * (0.3 + 1.2 * q);
        const x = w.x + a * Math.sin(w.freq * 2 * Math.PI * (q - rise * 0.35) + w.ph) + 0.4 * a * Math.sin(5.3 * q - rise * 1.3 + w.ph);
        d += `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      for (const p of w.paths) p.setAttribute('d', d);
    }
  },
});
