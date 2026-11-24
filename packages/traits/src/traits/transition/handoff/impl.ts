import { defineTransition } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineTransition({
  meta,
  between({ params }, w, t) {
    const k = (t - w.t0) / Math.max(1e-6, w.t1 - w.t0);
    if (k < params.show) w.incoming.ch.visible = false;
    if (k >= params.hide) w.outgoing.ch.visible = false;
  },
  /** The camera move of the window whooshes across it, panned with the swing direction (alternating). */
  sounds({ section, params }) {
    const w = section.window;
    if (!w || section.layer.sections[0] !== section || params.whoosh <= 0 || w.t1 - w.t0 < 0.05) return [];
    return [{ t: w.t0, until: w.t1, kind: 'whoosh', weight: params.whoosh, pan: section.index % 2 ? 0.3 : -0.3 }];
  },
});
