import { defineMeta } from '../../../contract.ts';

/**
 * Accessible info card: every section sits on one clean card (white on light palettes) with an accent stripe on its
 * start edge; rows hug the start edge at generous sizes, plain words in a book weight, emphasis and numbers bold.
 * List items get bullets, the city a location pin, the logos a plain badge. The card fades in with the section.
 */
export const meta = defineMeta({
  id: 'info-card',
  axis: 'layout',
  layer: 'dom',
  label: 'Info card',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.1, max: 0.4, default: 0.17, label: 'Largest base size (× safe width)' },
    pad: { min: 0.02, max: 0.12, default: 0.07, label: 'Card padding (× the safe area’s short side)' },
    leading: { min: 0.1, max: 1, default: 0.34, label: 'Gap between rows (em of the rows)' },
    weight: { min: 100, max: 900, default: 800, label: 'Bold weight (titles, emphasis, numbers)' },
    book: { min: 100, max: 900, default: 500, label: 'Book weight (plain words)' },
    radius: { min: 0, max: 0.1, default: 0.035, label: 'Card corner radius (× the safe area’s short side)' },
  },
});
