import { defineMeta } from '../../../contract.ts';

/**
 * Speed-ramp scroll (stacked-scroll): the camera only moves vertically. A section's column rushes up into place
 * from `reach` below and brakes hard onto the first landing (power ease-out); when the next scene layer comes, it
 * accelerates up and away (power ease-in) and cuts at full speed into the next column, which brakes in the same
 * way. Motion blur follows the speed. Holds are still.
 */
export const meta = defineMeta({
  id: 'ramp-scroll',
  axis: 'camera',
  layer: 'dom',
  label: 'Speed-ramp scroll',
  requires: { layout: ['scroll-stack'] },
  params: {
    ramp: { min: 2, max: 6, default: 4, label: 'Ramp sharpness (power of the ease)' },
    blur: { min: 0, max: 12, default: 3, label: 'Motion blur at full speed (px)' },
    whoosh: { min: 0, max: 1, default: 0.55, label: 'Whoosh weight per scroll (0 = silent)' },
  },
});
