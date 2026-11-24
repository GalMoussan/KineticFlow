import { defineMeta } from '../../../contract.ts';

/**
 * A page turns in from the reading-start edge: the incoming layer is clipped by a moving inset, a paper edge and a
 * soft shadow travel with the clip (no blend modes), and the outgoing page nudges aside and blurs a little. The
 * shadow is a pre-multiplied gradient under the incoming layer, so it only shows on the page still being covered.
 */
export const meta = defineMeta({
  id: 'page-turn',
  axis: 'transition',
  layer: 'dom',
  label: 'Page turn',
  scope: 'layer',
  params: {
    push: { min: 0, max: 0.2, default: 0.06, label: 'Outgoing nudge (× frame width)' },
    shade: { min: 0, max: 1, default: 0.55, label: 'Shadow strength' },
    blur: { min: 0, max: 12, default: 6, label: 'Outgoing blur (px)' },
  },
});
