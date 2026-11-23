import { defineMeta } from '../../../contract.ts';

/**
 * Kinetic-quote reveals chosen per unit from its tags: mask rise (plain), slide from the start edge (aligned accents,
 * weekday, city), emphasis rotating scale → drop → letters, drop (hero, pin), slot (numbers).
 */
export const meta = defineMeta({
  id: 'kinetic-mix',
  axis: 'reveal',
  layer: 'dom',
  label: 'Kinetic mix',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.14, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.5, label: 'Entrance duration (s)' },
  },
});
