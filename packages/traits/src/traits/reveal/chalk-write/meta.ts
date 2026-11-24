import { defineMeta } from '../../../contract.ts';

/**
 * Chalk draw-on: each word is written onto the board from its reading start, an inset clip opening at the pace of
 * a hand (longer words take longer), with a soft settle of opacity as the stroke dries; logos and pins fade up from
 * a slightly larger size. One scratchy swipe per word, lasting as long as it writes.
 */
export const meta = defineMeta({
  id: 'chalk-write',
  axis: 'reveal',
  layer: 'dom',
  label: 'Chalk write-on',
  params: {
    pace: { min: 0.02, max: 0.15, default: 0.06, label: 'Seconds per grapheme' },
    min: { min: 0.1, max: 0.6, default: 0.28, label: 'Shortest write (s)' },
    max: { min: 0.3, max: 1.5, default: 0.8, label: 'Longest write (s)' },
  },
});
