import { defineMeta } from '../../../contract.ts';

/**
 * EQ bars powering up: every letter grows from a point on its baseline with a small overshoot, staggered across the
 * unit from the start edge; logos and pins rise from their bottom edge. Before a cut to another scene layer the
 * letters drop back to the baseline (power-off), from the end edge.
 */
export const meta = defineMeta({
  id: 'bar-rise',
  axis: 'reveal',
  layer: 'dom',
  label: 'Bar rise (baseline grow)',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.4, default: 0.12, label: 'Start before landing (s)' },
    duration: { min: 0.15, max: 1, default: 0.36, label: 'Letter rise (s)' },
    stagger: { min: 0, max: 0.08, default: 0.035, label: 'Letter stagger (s)' },
  },
});
