import { defineMeta } from '../../../contract.ts';

/**
 * The readable copy fades in as the bands brake, and is fully opaque before the hold. It leaves at `out`
 * (the bands fly off on their own). One whoosh covers the scroll; a lock marks the stop.
 */
export const meta = defineMeta({
  id: 'band-lock',
  axis: 'reveal',
  layer: 'dom',
  label: 'Band lock',
  requires: { layout: ['ticker-board'] },
  params: {
    whoosh: { min: 0, max: 1, default: 0.4, label: 'Whoosh under the scrolling bands' },
    lock: { min: 0, max: 1, default: 0.45, label: 'Impact when the bands stop' },
  },
});
