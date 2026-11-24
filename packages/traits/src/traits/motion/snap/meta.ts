import { defineMeta } from '../../../contract.ts';

/**
 * Brutal snap: no easing. Every curve jumps in `steps` hard steps (1 = an instant cut at k > 0), like stop-motion; a
 * motion swap to snap turns any reveal, rule or wipe into hard cuts.
 */
export const meta = defineMeta({
  id: 'snap',
  axis: 'motion',
  layer: 'dom',
  label: 'Snap (no easing)',
  params: { steps: { min: 1, max: 8, default: 3, label: 'Hard steps per move (1 = instant cut)' } },
});
