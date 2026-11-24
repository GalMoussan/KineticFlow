import { defineMeta } from '../../../contract.ts';

/**
 * Letters morph outline-to-outline (harfbuzz outlines, `lib/morph`): each word of the previous section turns into
 * the nearest word of this section it morphs well into (same script, similar length; one more unpaired word may flow
 * into it too), the remaining words morph out of the latest earlier word they match (list items grow out of the
 * item above), else out of baseline bars. Two accent echoes trail the morph. Previous words without a good partner
 * (other script, very different length) dissolve while the new word forms: the crossfade fallback, recorded in
 * `section.data.reveal` (`merges`) and `unit.data.reveal.src/mode`. Needs `transition: cut` and a static camera.
 */
export const meta = defineMeta({
  id: 'glyph-morph',
  axis: 'reveal',
  layer: 'dom',
  label: 'Glyph morph',
  requires: { camera: ['static'], transition: ['cut'] },
  params: {
    duration: { min: 0.3, max: 1.5, default: 0.75, label: 'Morph length (s)' },
    echo: { min: 0, max: 1, default: 0.55, label: 'Echo trail strength' },
  },
});
