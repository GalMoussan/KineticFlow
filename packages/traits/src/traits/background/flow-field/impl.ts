/**
 * Flow-field streamlines. `mount` traces the streamlines of the shared field (`lib/flow.ts`) from a jittered seed
 * grid covering the frame (pure function of the format and params); `frame` clears and redraws the canvas from t:
 * background glow, one faint hairline path, comets with fading tails running downstream (brighter on the beat),
 * vignette. Screen space, so the next layer continues the same picture.
 */
import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { fieldOf, streamline } from '../../../lib/flow.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { frameCanvas } from '../../../lib/overlay.ts';
import { meta } from './meta.ts';

interface State {
  g: CanvasRenderingContext2D;
  lines: Float64Array[];
  steps: number;
}
const states = new WeakMap<Layer, State>();
/** Comet tail in steps, drawn in this many chunks of rising opacity. */
const TAIL = 26;
const CHUNKS = 6;

export default defineBackground({
  meta,
  mount({ host, layer, params }) {
    const { W, H } = host;
    const k = Math.min(W, H) / 1080;
    const f = fieldOf(W, H);
    const sp = (120 * k) / Math.sqrt(params.density);
    const h = 6 * k;
    const steps = Math.round((0.6 * Math.min(W, H)) / h);
    const lines: Float64Array[] = [];
    const nx = Math.ceil((1.3 * W) / sp);
    const ny = Math.ceil((1.3 * H) / sp);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i;
        const x = -0.15 * W + (i + 0.5 + (hash(n * 1.7 + 0.3) - 0.5) * 0.9) * sp;
        const y = -0.15 * H + (j + 0.5 + (hash(n * 2.3 + 0.7) - 0.5) * 0.9) * sp;
        lines.push(streamline(f, x, y, steps, h, 1));
      }
    }
    states.set(layer, { g: frameCanvas(host, 'flow-field', layer.under), lines, steps });
  },
  frame({ host, layer, params }, t) {
    const st = states.get(layer);
    if (!st) return;
    const { g, lines, steps } = st;
    const { W, H } = host;
    const k = Math.min(W, H) / 1080;
    const PAL = layer.palette;
    const pulse = host.beatPulse(t, 5);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    const base = g.createRadialGradient(host.safe.cx, host.safe.cy * 0.9, 0, host.safe.cx, host.safe.cy, Math.hypot(W, H) * 0.62);
    base.addColorStop(0, mixHex(PAL.bg, host.accent(2, layer), 0.1));
    base.addColorStop(1, PAL.bg);
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (params.lines > 0) {
      g.strokeStyle = rgba(PAL.text, 0.11 * params.lines);
      g.lineWidth = 1.3 * k;
      g.beginPath();
      for (const l of lines) {
        g.moveTo(l[0]!, l[1]!);
        for (let i = 1; i <= steps; i++) g.lineTo(l[2 * i]!, l[2 * i + 1]!);
      }
      g.stroke();
    }

    if (params.comets > 0) {
      const cycle = steps + TAIL;
      const v = 16 * params.speed;
      g.lineWidth = 2.6 * k;
      lines.forEach((l, j) => {
        const head = (((t * v * (0.7 + 0.6 * hash(j * 5.1 + 2))) + hash(j * 3.7 + 1) * cycle) % cycle + cycle) % cycle;
        const col = host.accent(j % 3, layer);
        const a = params.comets * (0.5 + 0.4 * pulse) * (0.45 + 0.55 * hash(j * 7.9 + 4));
        for (let c = 0; c < CHUNKS; c++) {
          const s0 = Math.max(0, Math.round(head - TAIL + (c * TAIL) / CHUNKS));
          const s1 = Math.min(steps, Math.round(head - TAIL + ((c + 1) * TAIL) / CHUNKS));
          if (s1 <= s0) continue;
          g.strokeStyle = rgba(col, (a * (c + 1)) / CHUNKS);
          g.beginPath();
          g.moveTo(l[2 * s0]!, l[2 * s0 + 1]!);
          for (let i = s0 + 1; i <= s1; i++) g.lineTo(l[2 * i]!, l[2 * i + 1]!);
          g.stroke();
        }
      });
    }

    if (params.vignette > 0) {
      const dark = mixHex(PAL.bg, '#000000', 0.55);
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      vg.addColorStop(0, rgba(dark, 0));
      vg.addColorStop(1, rgba(dark, params.vignette));
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    }
  },
  /** A pure function of t, the format, palette, params and beat grid (all in the host's fingerprint). */
  fingerprint: () => 'flow-field@1',
});
