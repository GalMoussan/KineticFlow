import { defineMeta } from '../../../contract.ts';

/**
 * Unfolding sheet (paper-fold). The panel is the safe rect — not the text — so a date edit cannot move it.
 * The fold resizes that box in whole pixels and shades it; the type is the reveal's, and it appears only once
 * the panel is flat. Odd sections fold on x, even on y.
 */
export const meta = defineMeta({
  id: 'paper-sheet',
  axis: 'layout',
  layer: 'dom',
  label: 'Paper sheet',
  requires: { reveal: ['unfold'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.15, max: 0.6, default: 0.36, label: 'Largest emphasis size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.64, label: 'Plain word size (× emphasis size)' },
    leading: { min: 0.04, max: 0.8, default: 0.18, label: 'Gap between rows (em of the rows)' },
  },
});
