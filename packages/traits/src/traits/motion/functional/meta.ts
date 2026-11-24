import { defineMeta } from '../../../contract.ts';

/**
 * Functional easing (linear / quad / cubic power curves): entrances decelerate, exits accelerate, nothing overshoots
 * (`bounce` ignores its overshoot constant). For calm, editorial reveals where motion must never upstage the text.
 */
export const meta = defineMeta({
  id: 'functional',
  axis: 'motion',
  layer: 'dom',
  label: 'Functional (linear/quad)',
  params: { power: { min: 1, max: 3, default: 2, label: 'Curve power (1 linear, 2 quad, 3 cubic)' } },
});
