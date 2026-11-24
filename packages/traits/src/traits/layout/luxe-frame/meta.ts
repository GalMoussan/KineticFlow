import { defineMeta } from '../../../contract.ts';

/**
 * Luxury print: small centred rows in a light serif floating in wide negative space, one size per role, small label
 * rows (weekday, city, list title, stat label) set with wide permanent tracking, a gold hairline above and below
 * every stack, the logos in a thin-ruled badge. Rows carry their centre (`unit.data.layout.cx`) and final tracking so
 * a reveal can track letters in about the row's middle.
 */
export const meta = defineMeta({
  id: 'luxe-frame',
  axis: 'layout',
  layer: 'dom',
  label: 'Luxe frame',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.06, max: 0.3, default: 0.14, label: 'Largest base size (× safe width)' },
    space: { min: 0, max: 0.3, default: 0.1, label: 'Side margin kept empty (× safe width, each side)' },
    leading: { min: 0.1, max: 1.2, default: 0.55, label: 'Gap between rows (em of the rows)' },
    weight: { min: 100, max: 900, default: 300, label: 'Font weight' },
    track: { min: 0, max: 0.8, default: 0.32, label: 'Label tracking (spread of small rows, × their width)' },
    rule: { min: 0, max: 1, default: 1, label: 'Hairlines above and below (0 = none)' },
  },
});
