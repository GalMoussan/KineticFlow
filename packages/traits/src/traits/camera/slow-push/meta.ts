import { defineMeta } from '../../../contract.ts';

/**
 * Tension push: a static framing that slowly zooms in on the safe-area centre through each section (from its
 * entry to its exit, eased), falling back to 1 on the next layer. `range` reports [1, 1 + push] so layouts fit
 * against the closest framing.
 */
export const meta = defineMeta({
  id: 'slow-push',
  axis: 'camera',
  layer: 'dom',
  label: 'Slow push',
  params: {
    push: { min: 0, max: 0.2, default: 0.06, label: 'Zoom reached at the section end (× 1 +)' },
  },
});
