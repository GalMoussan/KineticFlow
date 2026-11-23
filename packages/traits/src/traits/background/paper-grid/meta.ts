import { defineMeta } from '../../../contract.ts';

/** Warm paper with soft blotches and fibres, a dot grid living in the world, grain and a vignette on top. */
export const meta = defineMeta({
  id: 'paper-grid',
  axis: 'background',
  layer: 'canvas',
  label: 'Paper + dot grid',
  params: {
    grain: { min: 0, max: 0.2, default: 0.06, label: 'Grain strength' },
    vignette: { min: 0, max: 0.5, default: 0.13, label: 'Vignette strength' },
  },
});
