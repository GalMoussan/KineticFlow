import { defineMeta } from '../../../contract.ts';

/**
 * Split screen, A vs B: each section's content splits into two sides (before / after an "or · vs · או · נגד" word,
 * label and value, words and logos, or its two halves by length) on two accent panels that slam in from opposite
 * sides, side by side in wide formats and stacked otherwise, with a tilted seam and a centre badge (an accent disc
 * holding the connector word, else a bolt). One-item sections take the whole frame on one panel.
 */
export const meta = defineMeta({
  id: 'versus-split',
  axis: 'layout',
  layer: 'dom',
  label: 'Versus split',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    tilt: { min: 0, max: 0.12, default: 0.05, label: 'Seam tilt (× the frame side across it)' },
    badge: { min: 0.06, max: 0.2, default: 0.14, label: 'Badge radius (× the shorter safe side)' },
    slam: { min: 0.15, max: 0.6, default: 0.3, label: 'Panel slam duration (s)' },
  },
});
