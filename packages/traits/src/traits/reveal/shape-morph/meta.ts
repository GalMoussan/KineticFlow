import { defineMeta } from '../../../contract.ts';

/**
 * Circles and squares in the palette's accents pop in where the letters will stand (one per grapheme, niqqud
 * included), hold a beat, then morph into the letter outlines (`lib/morph`) while their colour turns into the text
 * colour; the real DOM text takes over at the landing. When the next section comes, its reveal turns this section's
 * letters back into shapes that tumble away. Needs `transition: cut` and a static camera for that exit.
 */
export const meta = defineMeta({
  id: 'shape-morph',
  axis: 'reveal',
  layer: 'dom',
  label: 'Shapes → letters',
  requires: { camera: ['static'], transition: ['cut'] },
  params: {
    duration: { min: 0.15, max: 1, default: 0.34, label: 'Shape → letter morph (s)' },
    pop: { min: 0.1, max: 0.6, default: 0.24, label: 'Shape pop-in (s)' },
    spread: { min: 0, max: 0.6, default: 0.3, label: 'Letter stagger across a word (s)' },
  },
});
