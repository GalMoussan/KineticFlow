import { defineMeta } from '../../../contract.ts';

/**
 * Colour swap per beat (word-per-beat): each solo word sits on a full-frame panel in the next palette accent and is
 * inked in the palette's text or background colour, whichever reads better; on the recap every row keeps its word's
 * accent band, and the bands (with their inks) step one accent on every beat of the hold.
 */
export const meta = defineMeta({
  id: 'beat-swap',
  axis: 'material',
  layer: 'dom',
  label: 'Beat colour swap',
  requires: { layout: ['beat-stack'] },
  params: {
    cycle: { min: 0, max: 1, default: 1, label: 'Recap bands step colours on the beat (0 = off)' },
  },
});
