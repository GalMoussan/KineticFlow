import { defineMeta } from '../../../contract.ts';

/**
 * Ransom-note slaps: every grapheme is slapped down one after another in reading order, dropping from a larger size
 * with a spin and the motion's overshoot, so a word assembles letter by letter; logos and pins slap down whole.
 * Before a cut to another scene layer the letters are torn off and flung away, one after another.
 */
export const meta = defineMeta({
  id: 'ransom',
  axis: 'reveal',
  layer: 'dom',
  label: 'Ransom letter slaps',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.14, label: 'Start before landing (s)' },
    duration: { min: 0.1, max: 0.8, default: 0.26, label: 'Slap duration per letter (s)' },
    stagger: { min: 0, max: 0.15, default: 0.055, label: 'Letter stagger (s)' },
    spin: { min: 0, max: 60, default: 24, label: 'Spin-in angle (deg)' },
    size: { min: 1, max: 3, default: 1.7, label: 'Start size (× rest)' },
    exit: { min: 0, max: 1, default: 1, label: 'Fling letters off before the next layer (0 = off)' },
  },
});
