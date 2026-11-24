import { defineMeta } from '../../../contract.ts';

/**
 * Mono high-contrast inks: plain words in the text colour, the hero and numbers in the signal accent, emphasis
 * inverted (background-coloured type on a solid ink block bled off the frame's start edge).
 */
export const meta = defineMeta({
  id: 'brutal-ink',
  axis: 'material',
  layer: 'dom',
  label: 'Brutal ink + inverted blocks',
  params: {
    blocks: { min: 0, max: 1, default: 1, label: 'Inverted blocks behind emphasis (0 = off)' },
  },
});
