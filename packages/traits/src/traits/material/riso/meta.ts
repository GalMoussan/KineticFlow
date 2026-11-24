import { defineMeta } from '../../../contract.ts';

/**
 * Risograph print: words in spot inks (palette text; hero, numbers and every other emphasis in the first accent) with
 * a second plate in the other ink printed off register under them (a `shadow` copy), which swings into near
 * register as the word lands and slips again on every beat of the hold (`section.pulse`). The ink itself is grainy:
 * a gloss overlay (`lib/gloss.ts`) lets the paper show through in hashed specks. The hero sits on a halftone disc in
 * a third ink.
 */
export const meta = defineMeta({
  id: 'riso',
  axis: 'material',
  layer: 'dom',
  label: 'Risograph inks (off-register plates, grain)',
  params: {
    offset: { min: 0, max: 0.12, default: 0.035, label: 'Resting misregistration (em)' },
    kick: { min: 0, max: 0.15, default: 0.05, label: 'Extra slip per beat (em)' },
    entry: { min: 0, max: 0.6, default: 0.28, label: 'Slip when the word lands (em)' },
    grain: { min: 0, max: 1, default: 0.6, label: 'Ink grain (paper specks in the ink)' },
    disc: { min: 0, max: 1, default: 1, label: 'Halftone disc behind the hero (0 = none)' },
  },
});
