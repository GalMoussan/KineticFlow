import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { mixHex } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

/** One blob: centre and radius (× the frame's shorter side), drift phase and colour. */
interface Blob {
  x: number;
  y: number;
  r: number;
  ph: number;
  color: string;
}

const N = 4;
const els = new WeakMap<Layer, HTMLElement[]>();

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const p = layer.palette;
    // corners first, so the blobs frame the text instead of sitting under its middle
    const spots = [
      [0.12, 0.14],
      [0.9, 0.42],
      [0.16, 0.8],
      [0.82, 0.95],
    ] as const;
    const blobs: Blob[] = spots.slice(0, N).map(([x, y], i) => {
      const h = hash(layer.index * 31 + i * 7 + 3);
      return { x: x + (h - 0.5) * 0.1, y: y + (hash(layer.index * 17 + i) - 0.5) * 0.08, r: 0.32 + 0.14 * h, ph: h * 6.283, color: mixHex(p.bg, host.accent(i, layer), params.tint) };
    });
    layer.data.background = { blobs };
    const fill = host.el('div', 'jb-fill', layer.under, { background: p.bg });
    els.set(layer, [fill, ...blobs.map((b) => host.el('div', 'jb-blob', layer.under, { background: b.color }))]);
  },
  frame({ host, layer, params }, t) {
    const { blobs } = layer.data.background as { blobs: Blob[] };
    const es = els.get(layer)!.slice(1);
    const D = Math.min(host.W, host.H);
    const beat = host.beatPulse(t, 7) * params.wobble;
    blobs.forEach((b, i) => {
      const e = es[i]!;
      const r = b.r * D * (1 + 0.04 * Math.sin(t * 0.7 + b.ph));
      const cx = b.x * host.W + 0.03 * D * Math.sin(t * 0.35 + b.ph);
      const cy = b.y * host.H + 0.03 * D * Math.cos(t * 0.3 + b.ph * 1.3);
      // morphing outline: four corner radii (each as horizontal / vertical %) on slow sines
      const rr = (k: number) => (50 + 14 * Math.sin(t * (0.5 + 0.13 * k) + b.ph + k * 1.7)).toFixed(1);
      const radius = `${rr(0)}% ${rr(1)}% ${rr(2)}% ${rr(3)}% / ${rr(4)}% ${rr(5)}% ${rr(6)}% ${rr(7)}%`;
      const w = beat * Math.sin(t * 18 + i);
      const s = e.style;
      s.left = `${(cx - r).toFixed(2)}px`;
      s.top = `${(cy - r).toFixed(2)}px`;
      s.width = `${(2 * r).toFixed(2)}px`;
      s.height = `${(2 * r).toFixed(2)}px`;
      s.borderRadius = radius;
      s.transform = `scale(${(1 + 0.05 * w).toFixed(4)}, ${(1 - 0.05 * w).toFixed(4)}) rotate(${(t * 6 + b.ph * 30).toFixed(2)}deg)`;
    });
  },
});
