import { defineMeta } from '../../../contract.ts';

/**
 * Horizontal lines of type above and below a hub (the reel's logos, or a disc), each line the chord of a ring.
 * The reveal rides the measured graphemes around that ring and settles them back onto the line. Not a world.
 */
export const meta = defineMeta({
  id: 'orbit-ring',
  axis: 'layout',
  layer: 'dom',
  label: 'Orbit rings',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    cap: { min: 0.08, max: 0.28, default: 0.16, label: 'Largest type (× the safe area’s shorter side)' },
    hub: { min: 0.08, max: 0.22, default: 0.13, label: 'Hub radius (× the safe area’s shorter side)' },
  },
});
