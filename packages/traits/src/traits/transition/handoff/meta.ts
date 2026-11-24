import { defineMeta } from '../../../contract.ts';

/**
 * Spatial hand-off between scene layers: the outgoing and incoming layers' own cameras and reveals play the move
 * (orbit swing, fly-through, turntable, cards flying off) while both layers are visible; the incoming one appears at
 * `show` and the outgoing one disappears at `hide` (fractions of the window). One whoosh spans the window.
 */
export const meta = defineMeta({
  id: 'handoff',
  axis: 'transition',
  layer: 'dom',
  label: 'Spatial hand-off',
  scope: 'layer',
  params: {
    show: { min: 0, max: 1, default: 0, label: 'Incoming layer appears at (fraction of the window)' },
    hide: { min: 0, max: 1, default: 1, label: 'Outgoing layer disappears at (fraction of the window)' },
    whoosh: { min: 0, max: 1, default: 0.5, label: 'Whoosh weight (0 = silent)' },
  },
});
