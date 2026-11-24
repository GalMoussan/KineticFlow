import { defineMeta } from '../../../contract.ts';

/**
 * Streamlines of the seeded flow field (`lib/flow.ts`) on the palette background: faint hairlines along the field
 * with bright comets travelling down them, brighter on the beat, under a soft vignette. One full-frame canvas in
 * `layer.under` redrawn from t; the lines are traced once per layer, so consecutive layers continue one picture.
 */
export const meta = defineMeta({
  id: 'flow-field',
  axis: 'background',
  layer: 'canvas',
  label: 'Flow-field streamlines',
  params: {
    density: { min: 0.3, max: 2, default: 1, label: 'Streamline density' },
    lines: { min: 0, max: 1, default: 0.5, label: 'Hairline strength' },
    comets: { min: 0, max: 1, default: 0.7, label: 'Comet strength (0 = none)' },
    speed: { min: 0, max: 3, default: 1, label: 'Comet speed' },
    vignette: { min: 0, max: 1, default: 0.6, label: 'Vignette strength' },
  },
});
