import { defineMeta } from '../../../contract.ts';

/**
 * Swiss modular grid (`lib/modules.ts` `moduleGrid`): every content unit owns a module span (a ruled cell, or a
 * solid one for the hero, numbers and emphasis) sized to fill it. Each landing re-solves the grid for the words so
 * far, and the earlier words FLIP (move + scale) into their new spans; between sections the outgoing modules gather
 * into the next section's first span before it splits again.
 */
export const meta = defineMeta({
  id: 'grid-reflow',
  axis: 'layout',
  layer: 'dom',
  label: 'Grid re-flow (FLIP)',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    per: { min: 1, max: 4, default: 3, label: 'Most units per grid line (one more on wide formats)' },
    rule: { min: 0, max: 2, default: 1, label: 'Module rule thickness (× default, 0 = none)' },
    move: { min: 0.15, max: 0.8, default: 0.4, label: 'Re-flow move duration (s)' },
  },
});
