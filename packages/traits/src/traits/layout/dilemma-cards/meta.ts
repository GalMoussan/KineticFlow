import { defineMeta } from '../../../contract.ts';

/**
 * Dilemma cards: every section sits on a dark card (center-stack's role rules inside it). A text section with a
 * connector word ("or · vs · או · נגד · מול") splits into two option cards, the first on the start side (stacked
 * when side by side would shrink the type), with the connector in a small accent disc on the seam; a question gets a
 * big '?' watermark; the answer is a face-down '?' card that flips to an accent card. In other text sections each
 * emphasised word (and the title's hero) waits under a '?' seal (two halves) that opens on its landing.
 */
export const meta = defineMeta({
  id: 'dilemma-cards',
  axis: 'layout',
  layer: 'dom',
  label: 'Dilemma cards',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    leading: { min: 0.05, max: 1.2, default: 0.34, label: 'Gap between rows (em of the rows)' },
    cap: { min: 0.15, max: 0.6, default: 0.28, label: 'Largest emphasis size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.62, label: 'Plain word size (× emphasis size)' },
    pad: { min: 0.02, max: 0.12, default: 0.055, label: 'Card padding (× the shorter safe side)' },
    disc: { min: 0.04, max: 0.16, default: 0.085, label: 'Connector disc radius (× the shorter safe side)' },
  },
});
