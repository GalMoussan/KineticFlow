import { defineMeta } from '../../../contract.ts';

/**
 * Chrome lettering: every text unit is filled with a metallic gradient keyed to its ink box (a gloss overlay,
 * `lib/gloss.ts`: background-clip text on a clone above the real text) with a light band sweeping across it at its
 * landing and again every `period` s. `horizon` blends the gradient from cool steel (dark band at the middle, tinted
 * by the emphasis accent) to 80s chrome (sky → white horizon line → hot ground in the palette's accents). Under the
 * fill, the real text carries a hairline dark rim, an extrusion of `depth` em in the darkened first accent and a
 * soft accent glow.
 */
export const meta = defineMeta({
  id: 'chrome',
  axis: 'material',
  layer: 'dom',
  label: 'Chrome (gradient fill + sheen)',
  params: {
    horizon: { min: 0, max: 1, default: 0, label: 'Gradient: 0 steel, 1 80s horizon chrome' },
    period: { min: 1, max: 8, default: 3.2, label: 'Sheen sweep period (s)' },
    sheen: { min: 0, max: 1, default: 0.85, label: 'Sheen strength (0 = off)' },
    depth: { min: 0, max: 0.2, default: 0.04, label: 'Extrusion depth (em)' },
    glow: { min: 0, max: 0.5, default: 0.12, label: 'Accent glow radius (em)' },
  },
});
