/**
 * Studio backdrop: one static stack of gradients (fill, spotlight, floor glow, vignette) and, when the layer's rig
 * has a floor (`rig.floor`, world y below the pivot), a square grid floor drawn through the rig's projection on a
 * full-frame `layer.under` canvas, cleared and redrawn every frame, so the floor turns with the world (a transformed
 * SVG floor made the text above it history-dependent: up to 5/255 in check (c)). Per frame: the root's visibility
 * (the `seam` rule) and the floor canvas.
 */
import { clamp01 } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { mix, project, rig } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

interface Backdrop {
  root: HTMLElement;
  floor: CanvasRenderingContext2D | null;
  /** Half the floor's side (world px) and its line colour. */
  half: number;
  ink: string;
}
const roots = new WeakMap<Layer, Backdrop>();
/** Grid cells per floor side (even, so the grid is symmetric under the turntable's 90° turns). */
const CELLS = 16;

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const P = layer.palette;
    const fill = mix(P.bg, P.text, params.table);
    const dark = mix(fill, '#000000', 0.6);
    const root = host.el('div', 'backdrop', layer.under, { background: fill });
    const lift = mix(fill, '#FFFFFF', 0.35);
    const cy = ((host.safe.cy - 0.12 * host.safe.h) / host.H) * 100;
    host.el('div', '', root, {
      background: `radial-gradient(ellipse 75% 55% at 50% ${cy.toFixed(1)}%, ${rgba(lift, 0.55 * params.light)} 0%, ${rgba(lift, 0)} 72%)`,
    });
    host.el('div', '', root, {
      background: `radial-gradient(ellipse 95% 32% at 50% 102%, ${rgba(host.accent(0, layer), 0.45 * params.floor)} 0%, ${rgba(host.accent(0, layer), 0)} 100%)`,
    });
    const r = rig(layer);
    let floor: CanvasRenderingContext2D | null = null;
    if (r.floor !== undefined && params.grid > 0) {
      const cv = host.el('canvas', '', root);
      cv.width = host.W;
      cv.height = host.H;
      floor = cv.getContext('2d')!;
    }
    host.el('div', '', root, {
      background: `radial-gradient(ellipse 80% 70% at 50% 48%, ${rgba(dark, 0)} 55%, ${rgba(dark, 0.75 * params.vignette)} 100%)`,
    });
    const half = 3 * (r.radius ?? Math.min(host.W, host.H) / 2);
    roots.set(layer, { root, floor, half, ink: mix(fill, P.text, 0.5) });
  },
  frame({ host, layer, params }, t) {
    const b = roots.get(layer);
    if (!b) return;
    const entering = params.seam >= 0.5 && layer.index > 0 && t < layer.sections[0]!.timing.in;
    b.root.style.visibility = entering ? 'hidden' : 'visible';
    const g = b.floor;
    const r = rig(layer);
    if (!g) return;
    g.clearRect(0, 0, host.W, host.H);
    if (entering || !r.proj || !r.origin || r.floor === undefined) return;
    const q = r.proj(t);
    const O = r.origin(t);
    const at = (x: number, z: number) => {
      const [px, py] = project(q, [x, r.floor!, z]);
      return [O[0] + px, O[1] + py] as const;
    };
    const step = (2 * b.half) / CELLS;
    g.lineWidth = Math.max(1.5, Math.min(host.W, host.H) / 700);
    // each grid line in short pieces whose alpha fades with the distance from the floor's centre
    const SEG = 8;
    for (let i = 0; i <= CELLS; i++) {
      const c = -b.half + i * step;
      for (const along of [true, false]) {
        for (let j = 0; j < SEG; j++) {
          const u0 = -b.half + (j * 2 * b.half) / SEG;
          const u1 = u0 + (2 * b.half) / SEG;
          const mid = (u0 + u1) / 2;
          const fade = clamp01(1 - Math.hypot(c, mid) / b.half);
          if (fade <= 0.01) continue;
          const [x0, y0] = along ? at(u0, c) : at(c, u0);
          const [x1, y1] = along ? at(u1, c) : at(c, u1);
          g.strokeStyle = rgba(b.ink, Math.min(1, 0.55 * params.grid) * fade);
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
      }
    }
  },
  /** Pixels follow palette, params, format and the layer's rig (camera/layout params and timings, all fingerprinted
   * through their own traits). */
  fingerprint: () => 'backdrop@2',
});
