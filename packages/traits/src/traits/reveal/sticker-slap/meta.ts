import { defineMeta } from '../../../contract.ts';

/**
 * Stickers slapped on: each unit pops from nothing with the motion's overshoot, spinning in from a hashed angle,
 * in reading order; before a cut to another scene layer every sticker peels off (it lifts and tilts, then
 * curls flat and flies off) inside the transition window.
 */
export const meta = defineMeta({
  id: 'sticker-slap',
  axis: 'reveal',
  layer: 'dom',
  label: 'Sticker slap + peel',
  params: {
    lead: { min: 0, max: 0.4, default: 0.12, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1, default: 0.42, label: 'Slap duration (s)' },
    spin: { min: 0, max: 90, default: 28, label: 'Spin-in angle (deg)' },
    peel: { min: 0, max: 1, default: 1, label: 'Peel-off exits (0 = off)' },
  },
});
