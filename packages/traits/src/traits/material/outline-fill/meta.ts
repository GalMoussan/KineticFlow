import { defineMeta } from '../../../contract.ts';

/**
 * Swiss print surfaces (dilemma-reel `reel12.js`): colours picked for contrast on the layer's solid panel; title
 * words are outlines whose fill sweeps in behind a highlighter edge and then kicks off-register (offset print);
 * every second emphasis sits on a solid block that wipes open; the time sits in a pill.
 */
export const meta = defineMeta({
  id: 'outline-fill',
  axis: 'material',
  layer: 'dom',
  label: 'Outline → fill',
  params: {
    outline: { min: 0, max: 0.06, default: 0.02, label: 'Title outline weight (em, 0 = solid titles)' },
    offset: { min: 0, max: 0.1, default: 0.04, label: 'Off-register kick (em)' },
    blocks: { min: 0, max: 1, default: 1, label: 'Emphasis blocks and time pill (0 = off)' },
  },
});
