import { hash } from '@reel/runtime';
import { defineBackground } from '../../../contract.ts';
import { meta } from './meta.ts';

const GRID = 72; // dot pitch; `layout: world-blocks` snaps block distances to it
const GRID_EXT = GRID * 400;

const rgba = (hex: string, a: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

/**
 * Static layers, drawn once at setup: paper (blotches + fibres) under the world, grain and vignette over it. Both
 * canvases are frozen into images: a canvas is a composited layer, and composited content under the world would get
 * every text element above it promoted (see README §1).
 */
export default defineBackground({
  meta,
  async setup({ host, layer, params }) {
    const { W, H } = host;
    const PAL = layer.palette;
    const paper = host.el('canvas', 'paper', layer.under);
    paper.width = W;
    paper.height = H;
    host.el('div', 'grid', layer.back, {
      left: `${-GRID_EXT}px`,
      top: `${-GRID_EXT}px`,
      width: `${2 * GRID_EXT}px`,
      height: `${2 * GRID_EXT}px`,
    });
    const grain = host.el('canvas', 'grain', layer.over, { width: `${W}px`, height: `${H}px` });
    grain.width = Math.round(W / 2);
    grain.height = Math.round(H / 2);
    host.el('div', 'vignette', layer.over, {
      background: `radial-gradient(ellipse 85% 70% at 50% 48%, transparent 60%, color-mix(in srgb, var(--text) ${(params.vignette * 100).toFixed(1)}%, transparent) 100%)`,
    });

    const g = paper.getContext('2d')!;
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, W, H);
    const scale = Math.max(W, H) / 1920;
    for (let i = 0; i < 14; i++) {
      const x = hash(i + 3) * W;
      const y = hash(i + 41) * H;
      const r = (220 + hash(i + 77) * 520) * scale;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, i % 3 === 0 ? rgba(host.accent(2, layer), 0.07) : i % 3 === 1 ? rgba(host.accent(3, layer), 0.06) : 'rgba(255,250,240,0.22)');
      gr.addColorStop(1, rgba(PAL.bg, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    g.strokeStyle = rgba(PAL.text, 0.035);
    g.lineWidth = 1;
    const fibres = Math.round((90 * W * H) / (1080 * 1920));
    for (let i = 0; i < fibres; i++) {
      const x = hash(i + 900) * W;
      const y = hash(i + 1900) * H;
      const a = hash(i + 2900) * Math.PI;
      const l = 20 + hash(i + 3900) * 70;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5 - 6, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    // Grain: a source-over layer of faint black/white specks (≤ 1/255 GPU render-order residue, unlike soft-light).
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
});
