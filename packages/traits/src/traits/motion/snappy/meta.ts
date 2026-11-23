import { defineMeta } from '../../../contract.ts';

/** Swiss snap: expo-out entrances, expo-in exits, expo-in-out wipes and rules; physical entrances overshoot. */
export const meta = defineMeta({
  id: 'snappy',
  axis: 'motion',
  layer: 'dom',
  label: 'Snappy (expo)',
  params: { overshoot: { min: 0, max: 3, default: 1, label: 'Overshoot (× each reveal’s own)' } },
});
