import { defineMeta } from '../../../contract.ts';

/**
 * The outgoing layer stays (its reveal plays the exit) until the window ends, then a hard cut under a white flash that
 * peaks at the cut and decays before the incoming first landing.
 */
export const meta = defineMeta({
  id: 'flash-cut',
  axis: 'transition',
  layer: 'dom',
  label: 'Flash cut',
  scope: 'layer',
  params: {
    flash: { min: 0, max: 1, default: 0.7, label: 'Flash opacity at the cut' },
    decay: { min: 2, max: 40, default: 14, label: 'Flash decay (1/s)' },
  },
});
