import { defineMeta } from '../../../contract.ts';

/**
 * A stylised city drawn into the full-frame `layer.under` canvas every frame: blocks on a seeded street grid, and
 * the route stroke catching up to the venue pin. Screen space follows the layer camera, including its pull-back.
 */
export const meta = defineMeta({
  id: 'city-map',
  axis: 'background',
  layer: 'canvas',
  label: 'City map',
  requires: { layout: ['map-route'] },
  params: {
    vignette: { min: 0, max: 0.8, default: 0.35, label: 'Edge vignette' },
  },
});
