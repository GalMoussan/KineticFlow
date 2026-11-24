import { defineMeta } from '../../../contract.ts';

/**
 * One magazine page: a folio (kicker + page number + rule) inside the safe area, then the section's type. A drop
 * cap is the first grapheme of the first word, enlarged on that word's start edge. Short sections are a headline
 * and, when a clause break leaves two real phrases, a standfirst. Display serif for the headline, the drop cap and
 * the figures; the text font for the body. Not a world: each section is a page.
 */
export const meta = defineMeta({
  id: 'magazine-page',
  axis: 'layout',
  layer: 'dom',
  label: 'Magazine page',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.12, max: 0.42, default: 0.22, label: 'Largest type (× the safe area’s shorter side)' },
  },
});
