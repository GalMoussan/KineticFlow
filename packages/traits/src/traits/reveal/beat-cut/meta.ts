import { defineMeta } from '../../../contract.ts';

/**
 * Hard cuts on the beat (word-per-beat): each solo word cuts in on its landing with a short scale punch (emphasis:
 * harder, with a skew snap) and holds until the next landing; at the recap the panel cuts away, the colour bands
 * and their rows wipe across from alternating sides and the newest row punches.
 */
export const meta = defineMeta({
  id: 'beat-cut',
  axis: 'reveal',
  layer: 'dom',
  label: 'Beat cut',
  requires: { layout: ['beat-stack'] },
  params: {
    punch: { min: 0, max: 0.6, default: 0.16, label: 'Landing punch (scale over 1)' },
    wipe: { min: 0.05, max: 0.5, default: 0.14, label: 'Recap band wipe (s)' },
    stagger: { min: 0, max: 0.1, default: 0.03, label: 'Recap row stagger (s)' },
  },
});
