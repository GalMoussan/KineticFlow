import { defineMeta } from '../../../contract.ts';

/**
 * Brutalist paste-up: a mono slug line (section number, time code) over a heavy bar, then the section's units one per
 * row hugging the start edge, each as wide as the safe width allows (a common cap keeps the column inside the safe
 * height), full-bleed rules between rows, a giant cropped section number behind; every content unit also gets a
 * giant copy cropped by the frame on an inverted full-frame panel for its landing flash.
 */
export const meta = defineMeta({
  id: 'brutal-grid',
  axis: 'layout',
  layer: 'dom',
  label: 'Brutalist grid',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    leading: { min: 0.1, max: 0.8, default: 0.3, label: 'Gap between rows (em)' },
    cap: { min: 0.1, max: 0.6, default: 0.36, label: 'Largest row size (× safe height)' },
    rule: { min: 0, max: 3, default: 1, label: 'Rule thickness (× default, 0 = none)' },
    giant: { min: 0.4, max: 1.5, default: 0.62, label: 'Giant flash type height (× frame height)' },
  },
});
