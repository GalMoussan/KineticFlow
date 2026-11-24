import { defineMeta } from '../../../contract.ts';

/**
 * Fluid typography: every line of a section is scaled so its ink fills the safe width exactly, the line breaks
 * chosen so the stack fills the safe height best; each line takes its own weight (short lines heavy, long ones
 * light). The layout is re-solved at every landing, so the sizes flow continuously: earlier lines shrink, re-break
 * and slide (FLIP) as words arrive, and a section's lines are squeezed up and away as the next one grows in.
 */
export const meta = defineMeta({
  id: 'fluid-fill',
  axis: 'layout',
  layer: 'dom',
  label: 'Fluid fill (lines fill the width)',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    lead: { min: 0, max: 0.4, default: 0.12, label: 'Gap between lines (em of the smaller line)' },
    perLine: { min: 1, max: 5, default: 3, label: 'Most words per line' },
    weights: { min: 0, max: 1, default: 1, label: 'Weight contrast between short and long lines (variable fonts)' },
    move: { min: 0.15, max: 0.8, default: 0.42, label: 'Re-flow duration (s)' },
  },
});
