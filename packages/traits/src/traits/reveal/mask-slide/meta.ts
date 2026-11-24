import { defineMeta } from '../../../contract.ts';

/**
 * Clean directional masks: every unit is clipped by its own box and its content slides in from the mask edge,
 * alternating per row between the start edge (reading direction) and the top edge; layout rules grow from their
 * origin. Before a cut to another layer the rows slide on out through the same masks. Eased only through
 * `section.motion` (pair with `motion: functional`).
 */
export const meta = defineMeta({
  id: 'mask-slide',
  axis: 'reveal',
  layer: 'dom',
  label: 'Mask slide',
  params: {
    lead: { min: 0, max: 0.5, default: 0.2, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.6, label: 'Slide duration (s)' },
    travel: { min: 0.5, max: 1.5, default: 1.05, label: 'Slide distance (× the mask)' },
    exit: { min: 0.1, max: 1, default: 0.4, label: 'Exit slide (s, within the transition window)' },
  },
});
