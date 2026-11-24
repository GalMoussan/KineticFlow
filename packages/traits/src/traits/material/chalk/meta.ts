import { defineMeta } from '../../../contract.ts';

/**
 * Chalk lettering: every text unit is filled through a gloss overlay (`lib/gloss.ts`) with its chalk colour broken
 * by a speckle of slate showing through (the stick skipping over the board's grain), over a soft dusty halo; plain
 * words in white chalk, emphasis rotating through the yellow / teal / pink chalks, the hero in accent 0. A puff of
 * chalk dust bursts from the line's foot as each word finishes and drifts away.
 */
export const meta = defineMeta({
  id: 'chalk',
  axis: 'material',
  layer: 'dom',
  label: 'Chalk (grainy fill + dust puffs)',
  params: {
    grain: { min: 0, max: 1, default: 0.55, label: 'Slate showing through the strokes' },
    halo: { min: 0, max: 0.2, default: 0.06, label: 'Dusty halo radius (em)' },
    puffs: { min: 0, max: 1, default: 1, label: 'Dust puffs on landings (0 = none)' },
  },
});
