import { defineMeta } from '../../../contract.ts';

/**
 * Centred stack with room for what moves around the type (center-stack's role rules, from `lib/rowset.ts`): extra
 * headroom above every row for letters that stretch up from their baseline (equalizer), a per-unit tilt that never
 * makes rotated ink boxes touch each other or leave the safe area (stickers), and a minimum number of words per row
 * (lyric lines). Locations get a pin in the first accent.
 */
export const meta = defineMeta({
  id: 'fit-stack',
  axis: 'layout',
  layer: 'dom',
  label: 'Fit stack (headroom / tilt / lines)',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard', 'lyric',
  ],
  params: {
    leading: { min: 0.05, max: 1.2, default: 0.32, label: 'Gap between rows (em of the rows)' },
    cap: { min: 0.15, max: 0.6, default: 0.34, label: 'Largest emphasis size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.62, label: 'Plain word size (× emphasis size)' },
    headroom: { min: 0, max: 1.5, default: 0, label: 'Extra room above each row (em; stretching letters)' },
    tilt: { min: 0, max: 12, default: 0, label: 'Largest unit tilt (deg; shrunk to stay clear)' },
    words: { min: 1, max: 4, default: 1, label: 'Fewest words per packed row' },
    pin: { min: 0, max: 1, default: 1, label: 'Location pin (0 = none)' },
  },
});
