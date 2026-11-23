import { defineMeta } from '../../../contract.ts';

/** Flat palette fills chosen per unit tag, with marker-swipe highlights behind every second emphasis. */
export const meta = defineMeta({
  id: 'flat',
  axis: 'material',
  layer: 'dom',
  label: 'Flat + swipes',
  params: {
    swipes: { min: 0, max: 1, default: 1, label: 'Swipe highlights (0 = off)' },
    tilt: { min: -6, max: 6, default: -1.4, label: 'Swipe tilt (deg)' },
  },
});
