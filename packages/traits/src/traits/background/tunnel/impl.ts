/**
 * Depth tunnel. Frame k sits at depth z_k = k · spacing on the camera path (`rig.travel`); at distance d it is a
 * rounded rectangle of half-size (size · W/2, size · H/2)/d centred on the vanishing point, its stroke width/d, rolled
 * with the camera. A fixed pool of elements shows frames k0 … k0 + n − 1 (k0 from the camera position at t), every
 * property rewritten each frame. Hidden during the layer's incoming window: the outgoing layer's identical tunnel
 * carries on under both layers.
 */
import { clamp01 } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { rgba } from '../../../lib/neon.ts';
import { mix, rig } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

const NEAR = 0.2;
const pools = new WeakMap<Layer, { root: HTMLElement; frames: HTMLElement[] }>();
const px = (v: number) => `${v.toFixed(2)}px`;

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const P = layer.palette;
    const deep = mix(P.bg, '#000000', 0.55);
    const glow = host.accent(0, layer);
    const cx = (host.safe.cx / host.W) * 100;
    const cy = (host.safe.cy / host.H) * 100;
    const root = host.el('div', 'tunnel', layer.under, {
      background:
        `radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ${rgba(mix(glow, '#FFFFFF', 0.3), 0.32)} 0%, ${rgba(glow, 0.12)} 9%, ${rgba(glow, 0)} 30%), ` +
        `radial-gradient(ellipse 80% 70% at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ${P.bg} 0%, ${deep} 100%)`,
    });
    const n = Math.ceil(params.far / params.spacing) + 1;
    pools.set(layer, { root, frames: Array.from({ length: n }, () => host.el('div', '', root)) });
  },
  frame({ host, layer, params }, t) {
    const pool = pools.get(layer);
    if (!pool) return;
    const r = rig(layer);
    pool.root.style.visibility = layer.index > 0 && t < layer.sections[0]!.timing.in ? 'hidden' : 'visible';
    const cam = r.travel?.(t) ?? 0;
    const roll = r.roll?.(t) ?? 0;
    const { W, H } = host;
    const m = Math.min(W, H);
    const k0 = Math.floor((cam + NEAR) / params.spacing) + 1;
    const accents = layer.palette.accents.length;
    pool.frames.forEach((e, j) => {
      const k = k0 + j;
      const d = k * params.spacing - cam;
      const fog = clamp01((params.far - d) / (0.6 * params.far)) * clamp01((d - NEAR) / 0.35);
      const s = e.style;
      if (fog <= 0.002) {
        s.visibility = 'hidden';
        s.left = s.top = s.width = s.height = '0px';
        s.borderWidth = '0px';
        s.boxShadow = 'none';
        s.borderRadius = '0px';
        s.borderStyle = 'solid';
        s.borderColor = 'transparent';
        s.opacity = '0';
        s.transform = 'none';
        return;
      }
      const hw = (params.size * W) / 2 / d;
      const hh = (params.size * H) / 2 / d;
      const bw = Math.max(1, (params.width * m) / d);
      const color = host.accent(((k % accents) + accents) % accents, layer);
      const g = params.glow * bw * 2.2;
      s.visibility = 'visible';
      s.left = px(host.safe.cx - hw);
      s.top = px(host.safe.cy - hh);
      s.width = px(2 * hw);
      s.height = px(2 * hh);
      s.borderStyle = 'solid';
      s.borderWidth = px(bw);
      s.borderColor = color;
      s.borderRadius = px((0.06 * m) / d);
      s.boxShadow = g > 0.3 ? `0 0 ${px(g)} ${color}, inset 0 0 ${px(g)} ${color}` : 'none';
      s.opacity = fog.toFixed(3);
      s.transform = roll ? `rotate(${(-roll).toFixed(3)}deg)` : 'none';
    });
  },
  /** Pixels follow the camera path (the camera's fingerprint), palette, params and format. */
  fingerprint: () => 'tunnel@1',
});
