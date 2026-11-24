import { defineMeta } from '../../../contract.ts';

/**
 * Crossing marquee bands (ticker-bands). Two diagonal bands (the band rotates, the letters only translate) scroll
 * the section's line and brake before the hold. A horizontal copy of the real text sits in an opaque plate the
 * colour of the background, so the crossing never paints through the words QA reads.
 */
export const meta = defineMeta({
  id: 'ticker-board',
  axis: 'layout',
  layer: 'dom',
  label: 'Ticker bands',
  requires: { reveal: ['band-lock'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.15, max: 0.7, default: 0.42, label: 'Largest emphasis size (× plate width)' },
    plain: { min: 0.3, max: 1, default: 0.64, label: 'Plain word size (× emphasis size)' },
    leading: { min: 0.04, max: 0.8, default: 0.16, label: 'Gap between rows (em of the rows)' },
    plate: { min: 0.45, max: 0.92, default: 0.74, label: 'Readable plate width (× safe width)' },
  },
});
