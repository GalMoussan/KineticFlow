import { defineMeta } from '../../../contract.ts';

/**
 * Data dashboard: every section is a dark data card with a header (accent dot + hairline), rows flush to the start
 * edge. Numbers tower over their labels and sit on a proportional bar (value ÷ the reel's largest stat or countdown
 * value) with quarter ticks; a time gets a 24-hour bar filled to the time of day. List items get square bullets in
 * rotating accents; text roles read as clean card copy (bold emphasis, book plain words).
 */
export const meta = defineMeta({
  id: 'stat-board',
  axis: 'layout',
  layer: 'dom',
  label: 'Stat board',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.1, max: 0.45, default: 0.3, label: 'Largest base size (× safe width)' },
    pad: { min: 0.02, max: 0.12, default: 0.055, label: 'Card padding (× the safe area’s short side)' },
    leading: { min: 0.1, max: 1, default: 0.3, label: 'Gap between rows (em of the rows)' },
    weight: { min: 100, max: 900, default: 800, label: 'Bold weight (titles, emphasis, numbers)' },
    book: { min: 100, max: 900, default: 500, label: 'Book weight (labels, plain words)' },
    bar: { min: 0.05, max: 0.4, default: 0.16, label: 'Bar thickness (× base size)' },
  },
});
