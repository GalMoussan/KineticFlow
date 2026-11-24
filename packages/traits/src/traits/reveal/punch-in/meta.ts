import { defineMeta } from '../../../contract.ts';

/**
 * Punch in: every unit cuts in whole on its landing from a larger uniform scale and snaps to size through the
 * motion's entrance curve (hero and emphasis from further out), logos and pins pop with the motion's bounce, and
 * an optional stage flash marks hero and emphasis landings. No exits: the layout or camera carries words away.
 * Impacts for hero, emphasis and numbers, pops rising in pitch for the rest.
 */
export const meta = defineMeta({
  id: 'punch-in',
  axis: 'reveal',
  layer: 'dom',
  label: 'Punch in',
  params: {
    lead: { min: 0, max: 0.3, default: 0.05, label: 'Start before landing (s)' },
    duration: { min: 0.1, max: 0.8, default: 0.26, label: 'Punch duration (s)' },
    scale: { min: 1, max: 3, default: 1.3, label: 'Start scale (hero and emphasis: × 1.25)' },
    flash: { min: 0, max: 0.6, default: 0, label: 'Stage flash on hero/emphasis landings' },
  },
});
