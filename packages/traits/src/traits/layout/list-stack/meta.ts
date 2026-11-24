import { defineMeta } from '../../../contract.ts';

/**
 * Top-N stack: every row of a section is a slab of one width, stacked in a centred column. List items are numbered:
 * a big numeral on an accent tab at the slab's start edge. Title and call-to-action rows are accent slabs inked in
 * the background colour, other rows dark slabs; the list title heads the stack without a slab. `section.data.layout`
 * lists each row's landing and the distance to the row above, so the reveal can stack the rows from the bottom up
 * (each new row pushes the earlier ones up).
 */
export const meta = defineMeta({
  id: 'list-stack',
  axis: 'layout',
  layer: 'dom',
  label: 'List stack',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.1, max: 0.4, default: 0.2, label: 'Largest base size (× safe width)' },
    gap: { min: 0, max: 0.6, default: 0.16, label: 'Gap between slabs (em of the rows)' },
    pad: { min: 0.1, max: 0.6, default: 0.26, label: 'Slab padding (em of its row)' },
    weight: { min: 100, max: 900, default: 800, label: 'Font weight' },
    tab: { min: 0.8, max: 2.5, default: 1.45, label: 'Numeral tab width (em of its row)' },
  },
});
