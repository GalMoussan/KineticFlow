import { defineMeta } from '../../../contract.ts';

/**
 * Launch-board stack (countdown): center-stack's role rules from `lib/rowset.ts`, numbers (date, time, stats,
 * countdowns) set in the text font (a mono face reads as a scoreboard) on dark number plates wide enough for every
 * countdown step, words in the display font. Locations get a pin in the first accent.
 */
export const meta = defineMeta({
  id: 'count-board',
  axis: 'layout',
  layer: 'dom',
  label: 'Count board',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    leading: { min: 0.05, max: 1.2, default: 0.42, label: 'Gap between rows (em of the rows)' },
    cap: { min: 0.15, max: 0.6, default: 0.3, label: 'Largest emphasis size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.6, label: 'Plain word size (× emphasis size)' },
    plate: { min: 0, max: 0.4, default: 0.16, label: 'Number plate padding (em, 0 = no plates)' },
  },
});
