import { defineMeta } from '../../../contract.ts';

/**
 * Gooey blobs carry the words: for each word a wobbling liquid drop rises from below the frame trailing a droplet on
 * a metaball neck, arrives where the word will stand, splits into one droplet per letter (necks stretching and
 * snapping), and every droplet morphs into its letter outline (`lib/morph`) before the real text takes over. The
 * previous section's letters melt back into droplets that drip out of the frame. SVG paths only. Needs `transition:
 * cut` and a static camera to carry the previous section's letters.
 */
export const meta = defineMeta({
  id: 'liquid-morph',
  axis: 'reveal',
  layer: 'dom',
  label: 'Liquid morph',
  requires: { camera: ['static'], transition: ['cut'] },
  params: {
    rise: { min: 0.2, max: 1.2, default: 0.55, label: 'Rise of the drop (s)' },
    split: { min: 0.1, max: 0.6, default: 0.22, label: 'Split into droplets (s)' },
    duration: { min: 0.15, max: 1, default: 0.36, label: 'Droplet → letter morph (s)' },
    wobble: { min: 0, max: 0.2, default: 0.08, label: 'Edge wobble (× radius)' },
  },
});
