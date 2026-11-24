import { defineMeta } from '../../../contract.ts';

/**
 * Droste frames (infinite-zoom). Text is a tall stack in the band above a centred hole `nest` times the safe card.
 * The hole is a decoration of the next card (fill, border, a scaled copy of its words). The last card is closed.
 * The next section is its own layer: at scale `nest` its card fills this hole.
 */
export const meta = defineMeta({
  id: 'nest-frames',
  axis: 'layout',
  layer: 'dom',
  label: 'Nested frames',
  requires: { camera: ['droste-zoom'], reveal: ['nest-show'] },
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    nest: { min: 0.18, max: 0.5, default: 0.32, label: 'Hole size (× the safe card); match camera.nest' },
    cap: { min: 0.2, max: 0.9, default: 0.78, label: 'Largest emphasis size (× the top band)' },
    plain: { min: 0.3, max: 1, default: 0.66, label: 'Plain word size (× emphasis size)' },
    leading: { min: 0.02, max: 0.5, default: 0.1, label: 'Gap between rows (em of the rows)' },
  },
});
