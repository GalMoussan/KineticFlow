import { defineMeta } from '../../../contract.ts';

/**
 * Uniform scale through the nested frames. A hold is exactly scale 1 (front-on, the size the layout fitted).
 * The incoming window goes nest → 1; the outgoing window goes 1 → 1/nest, which keeps this card's hole on the
 * next card. The first section has no incoming window, so it opens before its first landing instead.
 */
export const meta = defineMeta({
  id: 'droste-zoom',
  axis: 'camera',
  layer: 'dom',
  label: 'Droste zoom',
  requires: { layout: ['nest-frames'] },
  params: {
    nest: { min: 0.18, max: 0.5, default: 0.32, label: 'Incoming scale; match layout.nest' },
    whoosh: { min: 0, max: 1, default: 0.5, label: 'Whoosh on each zoom' },
  },
});
