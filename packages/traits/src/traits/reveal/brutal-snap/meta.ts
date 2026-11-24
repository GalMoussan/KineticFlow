import { defineMeta } from '../../../contract.ts';

/**
 * Brutalist hard cuts: each landing flashes its word giant and cropped on an inverted full-frame panel for a few
 * frames, then the row cuts into the grid with a stepped clip (the motion's steps); rules and the slug bar grow in
 * hard steps, the giant section number cuts in. No fades anywhere.
 */
export const meta = defineMeta({
  id: 'brutal-snap',
  axis: 'reveal',
  layer: 'dom',
  label: 'Brutal snap',
  requires: { layout: ['brutal-grid'] },
  params: {
    flash: { min: 0, max: 0.5, default: 0.2, label: 'Giant flash length (s; ≤ half the gap to the next landing)' },
    cut: { min: 0.03, max: 0.4, default: 0.1, label: 'Row clip-in length (s)' },
    rule: { min: 0.05, max: 0.8, default: 0.24, label: 'Rule growth (s)' },
  },
});
