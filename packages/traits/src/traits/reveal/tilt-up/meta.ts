import { defineMeta } from '../../../contract.ts';

/**
 * Planar-3D tilt: words (or their letters, staggered) stand up from lying flat, hinged at their ink bottom, with the
 * motion's overshoot tipping them slightly forward before they settle. Their height follows the exact projected
 * height of the tilting plane through the layer's 3D camera (orbit); the extrusion behind them keeps its true depth.
 * Pins and logos drop in.
 */
export const meta = defineMeta({
  id: 'tilt-up',
  axis: 'reveal',
  layer: 'dom',
  label: 'Tilt up (3D)',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.14, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.55, label: 'Entrance duration (s)' },
    stagger: { min: 0, max: 0.12, default: 0.045, label: 'Letter stagger (s)' },
  },
});
