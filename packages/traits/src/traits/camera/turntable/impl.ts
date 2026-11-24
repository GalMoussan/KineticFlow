/**
 * Turntable camera: turn(t) = step · Σ_j inOut(progress of section j's incoming window) + sway · sin(0.7 t), a pure
 * function of the cue sheet's timings, identical in every layer (so a turn continues across the layer hand-off).
 */
import { clamp01, easeInOut } from '@reel/runtime';
import { defineCamera } from '../../../contract.ts';
import { rig } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

export default defineCamera({
  meta,
  view: ({ host }) => ({ x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 }),
  setup({ host, layer, params }) {
    const windows = host.sections.flatMap((s) => (s.window ? [s.window] : []));
    rig(layer).turn = (t: number) => {
      let a = 0;
      for (const w of windows) a += w.t1 > w.t0 ? easeInOut(clamp01((t - w.t0) / (w.t1 - w.t0))) : t >= w.t0 ? 1 : 0;
      return params.step * a + params.sway * Math.sin(0.7 * t);
    };
  },
  /** The turn reaching the window depends on the windows of every section (all timings are fingerprinted per layer
   * only for visible layers), so report the windows overlapping it and how many turns precede it. */
  fingerprint({ host }, t0, t1) {
    const ws = host.sections.flatMap((s) => (s.window ? [s.window] : []));
    return { before: ws.filter((w) => w.t1 <= t0).length, live: ws.filter((w) => w.t1 > t0 && w.t0 < t1) };
  },
});
