import { defineMeta } from '../../../contract.ts';

/**
 * Psychedelic-science night (reel9): deep radial gradient, drifting colour orbs, rotating light rays, a phyllotaxis
 * spiral, an atom with three orbits, beat rings and rising stars, redrawn from t each frame; grain and vignette on top.
 */
export const meta = defineMeta({
  id: 'starfield',
  axis: 'background',
  layer: 'canvas',
  label: 'Starfield + atom',
  params: {
    energy: { min: 0, max: 1.5, default: 1, label: 'Energy (rays, rings, spiral)' },
    grain: { min: 0, max: 0.2, default: 0.05, label: 'Grain strength' },
    vignette: { min: 0, max: 1, default: 0.85, label: 'Vignette strength' },
  },
});
