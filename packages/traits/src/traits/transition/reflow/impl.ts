import { defineTransition } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineTransition({
  meta,
  /** Host default: both layers drawn, incoming on top; the layouts and the background fade do the rest. */
  between() {},
  sounds({ section, params }) {
    const w = section.window;
    if (!w || !params.whoosh || w.t1 - w.t0 < 0.05 || section.layer.sections[0] !== section) return [];
    return [{ t: w.t0, until: w.t1, kind: 'whoosh', weight: params.whoosh }];
  },
});
