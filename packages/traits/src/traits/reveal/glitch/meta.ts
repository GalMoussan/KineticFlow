import { defineMeta } from '../../../contract.ts';

/**
 * Digital glitch: words tear in as horizontal slices of themselves shifted sideways (clip-path copies of the text,
 * translate only), RGB-split, flickering and freezing in stutter steps; datamosh blocks of the word jump out of
 * place and macroblocks of colour smear over it. After landing, short bursts on chosen beats; nothing ever glitches
 * inside a hold; exits tear the words apart. Logos flicker in.
 */
export const meta = defineMeta({
  id: 'glitch',
  axis: 'reveal',
  layer: 'dom',
  label: 'Glitch slices',
  params: {
    lead: { min: 0.1, max: 0.8, default: 0.38, label: 'Glitch-in before landing (s)' },
    slices: { min: 3, max: 10, default: 7, label: 'Horizontal slices per word' },
    shift: { min: 0, max: 1.5, default: 0.55, label: 'Largest slice displacement (em)' },
    split: { min: 0, max: 2, default: 1, label: 'RGB split strength' },
    stutter: { min: 4, max: 30, default: 14, label: 'Stutter steps per second (a step holds its glitch)' },
    bursts: { min: 0, max: 1, default: 0.55, label: 'Share of beats with an after-shock burst' },
    blocks: { min: 0, max: 1, default: 0.8, label: 'Datamosh block strength' },
    exit: { min: 0.1, max: 1.2, default: 0.45, label: 'Exit duration (s, clipped to the window)' },
  },
});
