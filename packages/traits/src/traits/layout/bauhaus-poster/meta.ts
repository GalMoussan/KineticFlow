import { defineMeta } from '../../../contract.ts';

/**
 * Swiss/Bauhaus poster (port of dilemma-reel `reel12.js`): each section is one screen of large lines hugging the
 * start edge (or alternating / centred by role), sized to the safe width with role caps, separated by rules.
 */
export const meta = defineMeta({
  id: 'bauhaus-poster',
  axis: 'layout',
  layer: 'dom',
  label: 'Bauhaus poster',
  roles: [
    'title', 'tagline', 'body', 'teaser', 'cta', 'heading', 'question', 'answer', 'quote',
    'datetime', 'location', 'list', 'stat', 'countdown', 'endcard',
  ],
  params: {
    scale: { min: 0.5, max: 1.5, default: 1, label: 'Line size caps (× role default)' },
    chars: { min: 4, max: 24, default: 12, label: 'Graphemes per line before breaking' },
    gap: { min: 0, max: 0.6, default: 0.2, label: 'Gap between lines (× font size)' },
    rule: { min: 0, max: 3, default: 1, label: 'Rule thickness (× default, 0 = none)' },
  },
});
