import { hash } from '@reel/runtime';
import { defineBackground } from '../../../contract.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

export default defineBackground({
  meta,
  async setup({ host, layer, params }) {
    const { W, H } = host;
    const { bg, text } = layer.palette;
    const D = Math.min(W, H);
    const wood = host.accent(3, layer);
    const board = host.el('canvas', 'cb-board', layer.under);
    board.width = W;
    board.height = H;
    const g = board.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // slate mottling: big soft light and dark patches
    for (let i = 0; i < 14; i++) {
      const x = hash(i + 5.1) * W;
      const y = hash(i + 61.3) * H;
      const r = (0.18 + 0.4 * hash(i + 17.9)) * Math.max(W, H);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(i % 2 ? mixHex(bg, '#000000', 0.5) : mixHex(bg, text, 0.2), i % 2 ? 0.22 : 0.12));
      gr.addColorStop(1, rgba(bg, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // eraser smudges: wide translucent arcs of wiped chalk
    const sm = Math.round(9 * params.smudge);
    g.lineCap = 'round';
    for (let i = 0; i < sm; i++) {
      const h = (k: number) => hash(layer.index * 31 + i * 7 + k + 100);
      const x = h(1) * W;
      const y = h(2) * H;
      const r = D * (0.15 + 0.3 * h(3));
      const a0 = h(4) * Math.PI * 2;
      for (let j = 0; j < 6; j++) {
        g.strokeStyle = rgba(text, 0.018 + 0.012 * h(5 + j));
        g.lineWidth = D * (0.03 + 0.05 * h(11 + j));
        g.beginPath();
        g.arc(x + j * D * 0.008, y + j * D * 0.012, r, a0, a0 + 0.8 + 1.2 * h(6));
        g.stroke();
      }
    }
    // ghosts of old writing: faint scribbled loops
    const gh = Math.round(14 * params.smudge);
    g.lineWidth = Math.max(1.5, D * 0.003);
    for (let i = 0; i < gh; i++) {
      const h = (k: number) => hash(layer.index * 53 + i * 11 + k + 300);
      let x = h(1) * W;
      const y = h(2) * H;
      const len = D * (0.12 + 0.25 * h(3));
      const amp = D * (0.01 + 0.02 * h(4));
      g.strokeStyle = rgba(text, 0.035 + 0.03 * h(5));
      g.beginPath();
      g.moveTo(x, y);
      const n = 18;
      for (let k = 1; k <= n; k++) {
        x += len / n;
        g.lineTo(x + Math.sin(k * 1.9 + i) * amp * 0.6, y + Math.cos(k * 2.3 + i) * amp);
      }
      g.stroke();
    }
    // dust specks
    const im = g.getImageData(0, 0, W, H);
    const [tr, tg, tb] = [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)) as [number, number, number];
    const n = Math.round(W * H * params.dust * 0.25);
    for (let i = 0; i < n; i++) {
      const p = Math.floor(hash(i * 1.618 + 0.3) * W * H);
      const a = 0.12 + 0.35 * hash(i * 0.7071 + 9.1);
      const o = p * 4;
      im.data[o] = Math.round(im.data[o]! * (1 - a) + tr * a);
      im.data[o + 1] = Math.round(im.data[o + 1]! * (1 - a) + tg * a);
      im.data[o + 2] = Math.round(im.data[o + 2]! * (1 - a) + tb * a);
    }
    g.putImageData(im, 0, 0);
    // wooden frame: four rails with grain, mitred by drawing the dark joint diagonals, a dust tray on the bottom rail
    const F = Math.round(params.frame * D);
    if (F > 0) {
      const rail = (x: number, y: number, w: number, h: number, vertical: boolean, seed: number) => {
        const gr = vertical ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
        gr.addColorStop(0, mixHex(wood, '#FFFFFF', 0.18));
        gr.addColorStop(0.45, wood);
        gr.addColorStop(1, mixHex(wood, '#000000', 0.45));
        g.fillStyle = gr;
        g.fillRect(x, y, w, h);
        g.lineWidth = 1.2;
        for (let i = 0; i < 26; i++) {
          const q = hash(seed * 13 + i * 3.7);
          g.strokeStyle = rgba(mixHex(wood, '#000000', 0.5), 0.25 + 0.25 * hash(seed + i));
          g.beginPath();
          if (vertical) {
            const xx = x + q * w;
            g.moveTo(xx, y);
            g.bezierCurveTo(xx + w * 0.15, y + h * 0.3, xx - w * 0.15, y + h * 0.7, xx, y + h);
          } else {
            const yy = y + q * h;
            g.moveTo(x, yy);
            g.bezierCurveTo(x + w * 0.3, yy + h * 0.15, x + w * 0.7, yy - h * 0.15, x + w, yy);
          }
          g.stroke();
        }
      };
      rail(0, 0, W, F, false, 1);
      rail(0, H - F, W, F, false, 2);
      rail(0, 0, F, H, true, 3);
      rail(W - F, 0, F, H, true, 4);
      g.strokeStyle = rgba('#000000', 0.45);
      g.lineWidth = 2;
      for (const [x0, y0, x1, y1] of [[0, 0, F, F], [W, 0, W - F, F], [0, H, F, H - F], [W, H, W - F, H - F]] as const) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      // inner shadow of the frame on the slate
      const sh = Math.round(F * 0.6);
      const edges: [number, number, number, number, number, number, number, number][] = [
        [F, F, W - 2 * F, sh, 0, F, 0, F + sh],
        [F, H - F - sh, W - 2 * F, sh, 0, H - F, 0, H - F - sh],
        [F, F, sh, H - 2 * F, F, 0, F + sh, 0],
        [W - F - sh, F, sh, H - 2 * F, W - F, 0, W - F - sh, 0],
      ];
      for (const [x, y, w, h, gx0, gy0, gx1, gy1] of edges) {
        const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
        gr.addColorStop(0, rgba('#000000', 0.35));
        gr.addColorStop(1, rgba('#000000', 0));
        g.fillStyle = gr;
        g.fillRect(x, y, w, h);
      }
      // chalk dust collected on the bottom rail
      for (let i = 0; i < 40; i++) {
        const x = F + hash(i + 700.1) * (W - 2 * F);
        const w = D * (0.01 + 0.05 * hash(i + 800.3));
        g.fillStyle = rgba(text, 0.08 + 0.12 * hash(i + 900.7));
        g.beginPath();
        g.ellipse(x, H - F + F * 0.18, w, F * 0.12, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    await host.freeze(board);
  },
});
