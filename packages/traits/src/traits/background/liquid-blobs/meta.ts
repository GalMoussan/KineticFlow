import { defineMeta } from '../../../contract.ts';

/**
 * Lava-lamp backdrop: a few huge soft blobs in the palette's accents drift and breathe slowly over the palette
 * background (plain DOM radial gradients rewritten every frame from t alone, so consecutive layers continue
 * seamlessly). Strong and pastel for liquid looks, faint for dark morph reels.
 */
export const meta = defineMeta({
  id: 'liquid-blobs',
  axis: 'background',
  layer: 'dom',
  label: 'Liquid blobs',
  params: {
    strength: { min: 0, max: 1, default: 0.6, label: 'Blob opacity' },
    size: { min: 0.3, max: 1.5, default: 0.8, label: 'Blob size (× short frame side)' },
    speed: { min: 0, max: 2, default: 1, label: 'Drift speed' },
  },
});
