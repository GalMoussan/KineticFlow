import { defineMeta } from '../../../contract.ts';

/**
 * Neon fills (white, palette accents, cycling rainbow letters on the hero) with a beat-pulsing glow, RGB split from
 * the reveal scaled by `split`, and an FX canvas over the layer with spark bursts and shock rings on impacts.
 */
export const meta = defineMeta({
  id: 'neon-glow',
  axis: 'material',
  layer: 'canvas',
  label: 'Neon glow + bursts',
  params: {
    glow: { min: 0, max: 3, default: 1, label: 'Glow strength' },
    split: { min: 0, max: 3, default: 1, label: 'RGB split (× the reveal’s)' },
    burst: { min: 0, max: 2, default: 1, label: 'Burst strength (0 = none)' },
  },
});
