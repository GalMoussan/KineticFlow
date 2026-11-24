import { defineMeta } from '../../../contract.ts';

/**
 * The palette's background colour, optionally with a static print texture in the text colour: a halftone dot grid
 * (sticker sheets) and/or ruled grid lines (brutalist paste-up). Plain CSS gradients set once (nothing per frame).
 */
export const meta = defineMeta({
  id: 'plain',
  axis: 'background',
  layer: 'dom',
  label: 'Plain (+ dots / grid)',
  params: {
    dots: { min: 0, max: 1, default: 0, label: 'Dot grid strength (0 = none)' },
    grid: { min: 0, max: 1, default: 0, label: 'Grid line strength (0 = none)' },
  },
});
