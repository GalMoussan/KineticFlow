import { defineMeta } from '../../../contract.ts';

/**
 * Soft jelly backdrop: large blobs in pale tints of the palette's accents drift slowly, their rounded outlines
 * morphing (border radii on sines of t), and wobble on the beat like set jelly. Plain DOM shapes rewritten every
 * frame (no canvas, no blur filters).
 */
export const meta = defineMeta({
  id: 'jelly-blobs',
  axis: 'background',
  layer: 'dom',
  label: 'Jelly blobs',
  params: {
    tint: { min: 0, max: 1, default: 0.3, label: 'Blob tint strength (mix of accent into the background)' },
    wobble: { min: 0, max: 1, default: 0.5, label: 'Beat wobble' },
  },
});
