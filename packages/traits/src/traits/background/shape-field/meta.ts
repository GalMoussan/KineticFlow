import { defineMeta } from '../../../contract.ts';

/**
 * Geometric confetti for shape morphs: a few large outlined circles, squares and half-discs in the palette's accents
 * float near the frame edges, turning slowly and breathing on the beat (`section.pulse`), over the palette
 * background. Plain DOM elements rewritten every frame.
 */
export const meta = defineMeta({
  id: 'shape-field',
  axis: 'background',
  layer: 'dom',
  label: 'Floating shapes',
  params: {
    count: { min: 0, max: 12, default: 8, label: 'Shapes' },
    strength: { min: 0, max: 1, default: 0.35, label: 'Shape opacity' },
  },
});
