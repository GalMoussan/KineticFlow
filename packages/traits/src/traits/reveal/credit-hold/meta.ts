import { defineMeta } from '../../../contract.ts';

/**
 * The whole credit is already on its way up with the camera: this only fades the section in as one piece
 * (finished by `timing.in`, so the roll itself is readable) and ticks a soft lock as it settles. Per-word fades
 * would hide the type during the rise, because landings sit after `in`.
 */
export const meta = defineMeta({
  id: 'credit-hold',
  axis: 'reveal',
  layer: 'dom',
  label: 'Credit hold',
  requires: { layout: ['credits-column'] },
  params: {
    fade: { min: 0.05, max: 0.6, default: 0.28, label: 'Section fade (s), ending at the credit’s in-time' },
  },
});
