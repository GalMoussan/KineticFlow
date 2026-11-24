import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { torn } from '../../../lib/paper.ts';
import { meta } from './meta.ts';

/** A halftone shape's second plate: its element and the direction it slips in. */
interface Twin {
  el: HTMLElement;
  dx: number;
  dy: number;
}
const twins = new WeakMap<Layer, Twin[]>();

/** Edge slots (fractions of the frame) for shapes and scraps: corners and side bands, never the middle. */
const SLOTS: readonly [number, number][] = [
  [0.06, 0.08], [0.94, 0.05], [0.97, 0.38], [0.03, 0.47], [0.95, 0.74], [0.08, 0.9], [0.55, 0.97], [0.42, 0.02], [0.02, 0.22], [0.98, 0.95],
];

export default defineBackground({
  meta,
  async setup({ host, layer, params }) {
    const { W, H } = host;
    const { bg, text } = layer.palette;
    const D = Math.min(W, H);
    const paper = host.el('canvas', 'pp-paper', layer.under);
    paper.width = W;
    paper.height = H;
    const g = paper.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const blotches = Math.round(16 * params.fibres);
    for (let i = 0; i < blotches; i++) {
      const x = hash(i + 3.3) * W;
      const y = hash(i + 41.7) * H;
      const r = (0.15 + 0.35 * hash(i + 77.1)) * Math.max(W, H);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(i % 2 ? mixHex(bg, text, 0.5) : mixHex(bg, '#FFFFFF', 0.6), i % 2 ? 0.06 : 0.25));
      gr.addColorStop(1, rgba(bg, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    g.lineWidth = 1;
    const fibres = Math.round((260 * params.fibres * W * H) / (1080 * 1920));
    for (let i = 0; i < fibres; i++) {
      const x = hash(i + 900.5) * W;
      const y = hash(i + 1900.5) * H;
      const a = hash(i + 2900.5) * Math.PI;
      const l = 12 + hash(i + 3900.5) * 60;
      g.strokeStyle = rgba(i % 3 ? text : '#FFFFFF', i % 3 ? 0.05 : 0.18);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 5, y + Math.sin(a) * l * 0.5 - 5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }

    // risograph halftone shapes: plate B under plate A, a dot screen clipped to a disc, half-disc or bar
    const list: Twin[] = [];
    const shapes = Math.round(5 * params.halftone);
    const pitch = Math.max(6, Math.round(D * 0.016));
    for (let i = 0; i < shapes; i++) {
      const h = (k: number) => hash(layer.index * 97 + i * 13 + k);
      const [fx, fy] = SLOTS[i % SLOTS.length]!;
      const d = D * (0.2 + 0.16 * h(1));
      const kind = Math.floor(h(2) * 3);
      const box = {
        left: `${(fx * W - d / 2).toFixed(1)}px`,
        top: `${(fy * H - (kind === 1 ? d / 4 : d / 2)).toFixed(1)}px`,
        width: `${d.toFixed(1)}px`,
        height: `${(kind === 1 ? d / 2 : d).toFixed(1)}px`,
        'border-radius': kind === 0 ? '50%' : kind === 1 ? `${(d / 2).toFixed(1)}px ${(d / 2).toFixed(1)}px 0 0` : `${(d * 0.08).toFixed(1)}px`,
        transform: `rotate(${((h(3) - 0.5) * 70).toFixed(1)}deg)`,
      };
      const dots = (c: string, k: number) =>
        `radial-gradient(circle, ${c} ${(pitch * k).toFixed(2)}px, ${rgba(c, 0)} ${(pitch * k + 0.8).toFixed(2)}px) 0 0 / ${pitch}px ${pitch}px`;
      const ca = host.accent(i, layer);
      const cb = host.accent(i + 1, layer);
      const tw = host.el('div', 'pp-shape', layer.under, { ...box, background: dots(cb, 0.3), opacity: '0.8' });
      host.el('div', 'pp-shape', layer.under, { ...box, background: dots(ca, 0.36) });
      const a = (h(4) * 0.5 + 0.1) * Math.PI;
      list.push({ el: tw, dx: Math.cos(a), dy: Math.sin(a) });
    }
    twins.set(layer, list);

    // torn scraps: accents and newsprint, a few ruled, tilted, around the edges
    const scraps = Math.round(9 * params.scraps);
    for (let i = 0; i < scraps; i++) {
      const h = (k: number) => hash(layer.index * 71 + i * 17 + k + 500);
      const [fx, fy] = SLOTS[(i + 3) % SLOTS.length]!;
      const w = D * (0.2 + 0.18 * h(1));
      const ht = w * (0.45 + 0.6 * h(2));
      const c = i % 3 === 0 ? mixHex(bg, '#FFFFFF', 0.75) : host.accent(i, layer);
      const ruled = i % 3 === 0;
      host.el('div', 'pp-scrap', layer.under, {
        left: `${(fx * W - w / 2).toFixed(1)}px`,
        top: `${(fy * H - ht / 2).toFixed(1)}px`,
        width: `${w.toFixed(1)}px`,
        height: `${ht.toFixed(1)}px`,
        background: ruled
          ? `repeating-linear-gradient(180deg, ${rgba(text, 0)} 0px, ${rgba(text, 0)} ${(D * 0.012).toFixed(1)}px, ${rgba(text, 0.22)} ${(D * 0.012).toFixed(1)}px, ${rgba(text, 0.22)} ${(D * 0.014).toFixed(1)}px), ${c}`
          : c,
        'clip-path': torn(layer.index * 7 + i, 9),
        transform: `rotate(${((h(3) - 0.5) * 40).toFixed(1)}deg)`,
        opacity: '0.92',
      });
    }

    // grain over everything (source-over specks; see paper-grid)
    const grain = host.el('canvas', 'pp-grain', layer.over, { width: `${W}px`, height: `${H}px` });
    grain.width = Math.round(W / 2);
    grain.height = Math.round(H / 2);
    const gg = grain.getContext('2d')!;
    const im = gg.createImageData(grain.width, grain.height);
    for (let i = 0; i < grain.width * grain.height; i++) {
      const v = hash(i * 1.37 + 0.5) * 2 - 1;
      const c = v > 0 ? 255 : 0;
      im.data[i * 4] = c;
      im.data[i * 4 + 1] = c;
      im.data[i * 4 + 2] = c;
      im.data[i * 4 + 3] = Math.round(Math.abs(v) * params.grain * 255);
    }
    gg.putImageData(im, 0, 0);
    await Promise.all([host.freeze(paper), host.freeze(grain)]);
  },
  /** The second plate of every halftone shape slips off register on the beat and settles back. */
  frame({ host, layer, params }, t) {
    const list = twins.get(layer)!;
    if (!list.length) return;
    const D = Math.min(host.W, host.H);
    const s = layer.sections.findLast((x) => t >= (x.window?.t0 ?? -Infinity)) ?? layer.sections[0]!;
    const p = Math.max(0, Math.min(1, s.pulse(t)));
    const off = D * (0.008 + params.kick * p);
    for (const tw of list) {
      const st = tw.el.style;
      st.translate = `${(tw.dx * off).toFixed(2)}px ${(tw.dy * off).toFixed(2)}px`;
    }
  },
});
