import { defineMeta } from '../../../contract.ts';

/**
 * reel9 reveals chosen per unit from its tags: slam with RGB split (title/CTA words), rise (plain words, logos),
 * track-in (weekday, city, list title), slot (numbers), pop (hero), emphasis rotating slam → pop → scramble → drop,
 * drop (pin). Exits (whip / zoom / fall, rotating per section) play in the transition window before the next layer.
 */
export const meta = defineMeta({
  id: 'neon-mix',
  axis: 'reveal',
  layer: 'dom',
  label: 'Neon mix',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.1, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.4, label: 'Entrance duration (s)' },
    exit: { min: 0.1, max: 1, default: 0.32, label: 'Exit duration (s, within the transition window)' },
  },
});
