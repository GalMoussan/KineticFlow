import { defineMeta } from '../../../contract.ts';

/**
 * Every section is a centred vertical stack inside the safe area (neon / reel9): emphasis and title words get big
 * rows of their own, plain words pack into smaller rows, numbers tower over their labels, logos sit in a badge.
 */
export const meta = defineMeta({
  id: 'center-stack',
  axis: 'layout',
  layer: 'dom',
  label: 'Centred stack',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    leading: { min: 0.05, max: 1, default: 0.3, label: 'Gap between rows (em of the rows)' },
    cap: { min: 0.15, max: 0.6, default: 0.34, label: 'Largest emphasis size (× safe width)' },
    plain: { min: 0.3, max: 1, default: 0.62, label: 'Plain word size (× emphasis size)' },
  },
});
