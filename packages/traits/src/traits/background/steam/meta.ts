import { defineMeta } from '../../../contract.ts';

/**
 * A warm café haze: the latte palette background under a soft glow of milk foam (accent 2) and darker roasted
 * corners, with wisps of steam curling up from below the frame and fading towards the top. Wisps are SVG strokes
 * (a wide faint stroke under a narrower brighter one, no filters) whose curls travel upwards, rewritten every frame
 * from t alone.
 */
export const meta = defineMeta({
  id: 'steam',
  axis: 'background',
  layer: 'dom',
  label: 'Coffee steam',
  params: {
    wisps: { min: 0, max: 8, default: 5, label: 'Steam wisps' },
    strength: { min: 0, max: 1, default: 0.55, label: 'Steam opacity' },
    speed: { min: 0, max: 2, default: 0.6, label: 'Rising speed' },
  },
});
