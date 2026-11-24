import { defineMeta } from '../../../contract.ts';

/**
 * Y2K bubble letters: every text unit is filled with a glossy candy gradient (a gloss overlay, `lib/gloss.ts`) in
 * its accent, with a white glint on the upper ink and a fixed iridescent band, over a puffy rim stack
 * (white inner rim, darker candy outer rim, a short drop below). Hero and emphasised words burst four-point
 * sparkles that keep twinkling.
 */
export const meta = defineMeta({
  id: 'bubble',
  axis: 'material',
  layer: 'dom',
  label: 'Bubble letters + sparkles',
  params: {
    rim: { min: 0, max: 0.12, default: 0.05, label: 'Puffy rim width (em)' },
    drop: { min: 0, max: 0.15, default: 0.06, label: 'Drop below (em)' },
    sparkles: { min: 0, max: 5, default: 3, label: 'Sparkles per key word' },
    iris: { min: 0, max: 1, default: 0.5, label: 'Iridescent sheen strength' },
  },
});
