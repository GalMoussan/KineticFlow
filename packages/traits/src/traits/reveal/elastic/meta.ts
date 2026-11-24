import { defineMeta } from '../../../contract.ts';

/**
 * Squash and stretch: words fall in stretched and land in a squash that wobbles out on a damped spring (sx and sy
 * in anti-phase, pivoting on the baseline); emphasis and hero words do it letter by letter (jelly), numbers and
 * logos spring up from nothing. Before the next layer everything squats, then stretches up and away.
 */
export const meta = defineMeta({
  id: 'elastic',
  axis: 'reveal',
  layer: 'dom',
  label: 'Elastic squash & stretch',
  needs: { chars: true },
  params: {
    fall: { min: 0.12, max: 0.6, default: 0.26, label: 'Fall duration before the landing (s)' },
    squash: { min: 0, max: 0.6, default: 0.3, label: 'Squash on landing (fraction of the height)' },
    wobble: { min: 8, max: 40, default: 22, label: 'Wobble frequency (rad/s)' },
    damping: { min: 2, max: 14, default: 6.5, label: 'Wobble damping (1/s)' },
    stagger: { min: 0, max: 0.12, default: 0.045, label: 'Letter stagger (s)' },
    exit: { min: 0.15, max: 0.8, default: 0.4, label: 'Exit duration (s, within the transition window)' },
  },
});
