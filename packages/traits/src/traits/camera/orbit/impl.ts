/**
 * Orthographic orbit camera. The 2D view stays the identity; the 3D pose (yaw, pitch) is applied per unit: each unit
 * lies on its section's plane z = 0 (group point g → world (place + g − pivot, 0)) and gets the exact affine map of
 * that plane (`placeOnPlane`), composed under whatever later traits add. The pivot is the safe area's centre.
 * Text units keep the plane's position and its area scale (√(sx·sy), uniform) but not its slope, shear or
 * anisotropy: Chromium draws rotated, sheared or non-uniformly scaled glyphs from its glyph atlas with filtering that
 * depends on what was drawn before (2–3/255 in `dev/stills.ts` checks (b)/(c)), while uniformly scaled glyphs are
 * rasterised directly (0–1/255). The extrusion (solved through the drawn transform) still shows the true depth
 * direction, and every decoration keeps the exact map.
 */
import { clamp01, smooth } from '@reel/runtime';
import { defineCamera, type Layer } from '../../../contract.ts';
import { orbit, ortho, placeOnPlane, rig, steep, type Plane } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

type P = { yaw: number; pitch: number; swing: number; lift: number; sway: number; margin: number };

/** The pose schedule of a layer: entry swing [a, b] (direction din), exit swing over the next window [o0, o1]. */
function keys(L: Layer) {
  const s0 = L.sections[0]!;
  const sN = L.sections.at(-1)!;
  const w = s0.window;
  const a = w ? w.t0 + 0.4 * (w.t1 - w.t0) : 0;
  const b = Math.max(a + 0.4, Math.min(s0.timing.holdStart, a + 1.6));
  const n = sN.next;
  const exit = n && n.layer !== L && n.window && n.window.t1 > n.window.t0 ? { o0: n.window.t0, o1: n.window.t1, dout: n.index % 2 ? 1 : -1 } : null;
  return { a, b, din: s0.index % 2 ? 1 : -1, exit };
}

function pose(L: Layer, p: P, t: number): { yaw: number; pitch: number } {
  const { a, b, din, exit } = keys(L);
  const k = clamp01((t - a) / (b - a));
  const e = 1 - Math.pow(1 - k, 3);
  let yaw = p.yaw - din * p.swing * (1 - e);
  let pitch = p.pitch + p.lift * (1 - e);
  if (t > b) {
    const h = t - b;
    const on = smooth(clamp01(h / 0.8));
    yaw += p.sway * Math.sin(1.1 * h) * on;
    pitch += 0.5 * p.sway * Math.sin(0.8 * h) * on;
  }
  if (exit && t > exit.o0) {
    const x = clamp01((t - exit.o0) / (exit.o1 - exit.o0));
    yaw += exit.dout * p.swing * x * x;
  }
  return { yaw, pitch };
}

export default defineCamera({
  meta,
  view: ({ host }) => ({ x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 }),
  range: ({ params }) => [1, params.margin],
  setup({ host, layer, params }) {
    const v: [number, number] = [host.safe.cx, host.safe.cy];
    Object.assign(rig(layer), {
      proj: (t: number) => {
        const q = pose(layer, params, t);
        return ortho(orbit(q.yaw, q.pitch));
      },
      origin: () => v,
    });
  },
  frame({ host, layer, params }, t) {
    const { yaw, pitch } = pose(layer, params, t);
    const q = ortho(orbit(yaw, pitch));
    const v: [number, number] = [host.safe.cx, host.safe.cy];
    for (const s of layer.sections) {
      const plane: Plane = { o: [s.place.x - v[0], s.place.y - v[1], 0], e1: [1, 0, 0], e2: [0, 1, 0] };
      for (const u of s.units) {
        placeOnPlane(u, q, plane, v);
        if (!u.text) continue;
        u.ch.visible &&= !steep(u.ch);
        u.ch.rot = 0;
        u.ch.skx = 0;
        u.ch.sx = u.ch.sy = Math.sqrt(Math.abs(u.ch.sx * u.ch.sy));
      }
    }
  },
  fingerprint: ({ layer }) => keys(layer),
});
