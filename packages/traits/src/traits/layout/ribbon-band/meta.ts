import { defineMeta } from '../../../contract.ts';

/**
 * Ribbon rows: each section is a centred stack of rows, and every row lies on its own ribbon: a band that swoops in
 * from off-frame on the row's end side, runs straight under the row's text and swoops out on the start side, curving
 * away from the stack's middle. The layout stores each ribbon's geometry (two cubic swoops joined by the straight
 * run, group px) in `section.data.layout` for the reveal that draws the bands and flows the letters along them, and
 * picks each unit's ink for contrast on its band (`unit.data.layout.ink`, read by `material: tile-ink`).
 */
export const meta = defineMeta({
  id: 'ribbon-band',
  axis: 'layout',
  layer: 'dom',
  label: 'Ribbon rows',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.06, max: 0.3, default: 0.16, label: 'Largest base size (× safe width)' },
    leading: { min: 0.5, max: 1.4, default: 0.72, label: 'Gap between rows (em of the rows)' },
    weight: { min: 300, max: 900, default: 600, label: 'Font weight (emphasis one step heavier)' },
    pad: { min: 0.1, max: 0.4, default: 0.2, label: 'Band padding around the ink (em)' },
    swoop: { min: 0.1, max: 0.5, default: 0.3, label: 'Vertical reach of the swoops (× frame height)' },
  },
});
