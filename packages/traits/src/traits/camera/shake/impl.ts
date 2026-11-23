import { defineCamera, type Layer } from '../../../contract.ts';
import { meta } from './meta.ts';

/** The layer's impacts: every unit that declared a `hit` (its reveal decides), in unit order. */
const hitsOf = (layer: Layer): { id: number; t: number; amp: number }[] =>
  layer.sections.flatMap((s) => s.units.flatMap((u) => (u.hit ? [{ id: u.id, ...u.hit }] : [])));

export default defineCamera({
  meta,
  view: ({ host }) => ({ x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 }),
  frame({ host, layer, params }, t) {
    const sc = host.stageCh;
    for (const h of hitsOf(layer)) {
      const a = t - h.t;
      if (a < 0 || a > params.length) continue;
      const d = Math.exp(-a * params.decay) * h.amp * params.shake;
      sc.shakeX += Math.sin(a * 71 + h.id) * d;
      sc.shakeY += Math.cos(a * 59 + h.id * 2) * d;
      sc.shakeRot += Math.sin(a * 43 + h.id) * d * 0.04;
    }
  },
  /** Hits whose shake reaches the window (they live in unit snapshots too, but those are skipped off screen). */
  fingerprint({ layer, params }, t0, t1) {
    return hitsOf(layer).filter((h) => h.t < t1 && h.t + params.length >= t0);
  },
});
