import { defineMeta } from '../../../contract.ts';

/**
 * Printed paper stock: the palette's paper with blotches and fibres and a speckled grain over everything (canvases
 * drawn once and frozen into images), optionally with risograph halftone shapes near the frame edges, each printed
 * in two spot inks whose second plate slips off register on every beat, and/or torn magazine scraps (jagged
 * clip-path polygons, some ruled like newsprint) pinned around the edges for collages.
 */
export const meta = defineMeta({
  id: 'paper-print',
  axis: 'background',
  layer: 'canvas',
  label: 'Paper print (riso halftone / collage scraps)',
  params: {
    grain: { min: 0, max: 0.3, default: 0.1, label: 'Grain strength' },
    fibres: { min: 0, max: 1, default: 0.4, label: 'Fibres and blotches' },
    halftone: { min: 0, max: 1, default: 0, label: 'Halftone shapes (0 = none)' },
    scraps: { min: 0, max: 1, default: 0, label: 'Torn paper scraps (0 = none)' },
    kick: { min: 0, max: 0.03, default: 0.012, label: 'Plate slip per beat (× short frame side)' },
  },
});
