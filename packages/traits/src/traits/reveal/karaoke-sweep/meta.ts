import { defineMeta } from '../../../contract.ts';

/**
 * Karaoke: the section's lines appear whole (soft fade and lift) when it starts, then each word's sung colour sweeps
 * open over its unsung copy in reading direction (per word: RTL words from the right, LTR words from the left), from
 * just before its landing until shortly before the next word's; a bouncing ball hops from word to word, landing on
 * each as its sweep starts, and leaves before the hold. Lines fade out in the window before another scene layer.
 */
export const meta = defineMeta({
  id: 'karaoke-sweep',
  axis: 'reveal',
  layer: 'dom',
  label: 'Karaoke sweep + ball',
  params: {
    lead: { min: 0, max: 0.3, default: 0.06, label: 'Sweep starts before the landing (s)' },
    sweep: { min: 0.1, max: 1.5, default: 0.5, label: 'Longest word sweep (s)' },
    ball: { min: 0, max: 1, default: 1, label: 'Bouncing ball (0 = none)' },
    hop: { min: 0.2, max: 1.5, default: 0.55, label: 'Ball hop height (em)' },
  },
});
