import { defineMeta } from '../../../contract.ts';

/**
 * Letters drift in on the seeded flow field (`lib/flow.ts`): each grapheme rides the field's streamline upstream of
 * its place, turning with the flow and settling exactly into place for the hold; exits carry the letters on
 * downstream. Logos fade up. Soft shimmers per landing, a breath of wind on exits.
 */
export const meta = defineMeta({
  id: 'flow-drift',
  axis: 'reveal',
  layer: 'dom',
  label: 'Flow drift',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.6, default: 0.1, label: 'Last letter lands this long after the unit’s landing (s)' },
    duration: { min: 0.4, max: 2.5, default: 1.25, label: 'Drift duration per letter (s)' },
    distance: { min: 0.1, max: 1.2, default: 0.5, label: 'Drift distance (× short frame side)' },
    stagger: { min: 0, max: 0.12, default: 0.045, label: 'Delay between letters (s)' },
    tilt: { min: 0, max: 60, default: 28, label: 'Largest letter tilt along the flow (deg)' },
    exit: { min: 0.1, max: 1.5, default: 0.6, label: 'Exit duration (s, clipped to the window)' },
  },
});
