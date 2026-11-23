import { defineMeta } from '../../../contract.ts';

/** Every entrance overshoots (back-out). */
export const meta = defineMeta({
  id: 'overshoot',
  axis: 'motion',
  layer: 'dom',
  label: 'Overshoot',
  params: { overshoot: { min: 0, max: 3, default: 1, label: 'Overshoot (× each reveal’s own)' } },
});
