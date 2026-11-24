import { defineMeta } from '../../../contract.ts';

/**
 * Liquid metal on a dark studio backdrop: a few mercury blobs float around the frame edges, wobbling and swelling on
 * the beat, joined by metaball necks when they drift close, each filled with a chrome gradient and a specular
 * highlight; a mercury pool ripples along the bottom edge. SVG paths rewritten every frame from t (no filters);
 * nothing liquid ever touches the text.
 */
export const meta = defineMeta({
  id: 'liquid-chrome',
  axis: 'background',
  layer: 'dom',
  label: 'Liquid chrome blobs',
  params: {
    count: { min: 0, max: 6, default: 5, label: 'Blobs' },
    size: { min: 0.05, max: 0.4, default: 0.14, label: 'Blob radius (× short frame side)' },
    wobble: { min: 0, max: 0.2, default: 0.08, label: 'Edge wobble (× radius)' },
    pool: { min: 0, max: 0.2, default: 0.06, label: 'Mercury pool height (× frame height, 0 = none)' },
  },
});
