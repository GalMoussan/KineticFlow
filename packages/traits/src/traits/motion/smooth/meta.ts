import { defineMeta } from '../../../contract.ts';

/** Exponential ease-out entrances; physical entrances keep a back-out overshoot. */
export const meta = defineMeta({
  id: 'smooth',
  axis: 'motion',
  layer: 'dom',
  label: 'Smooth',
  params: { overshoot: { min: 0, max: 3, default: 1, label: 'Overshoot (× each reveal’s own)' } },
});
