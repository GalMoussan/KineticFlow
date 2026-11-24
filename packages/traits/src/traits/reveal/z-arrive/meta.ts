import { defineMeta } from '../../../contract.ts';

/**
 * Words fly at the camera out of the tunnel: each starts `depth` focal lengths behind its section's plane (exact
 * perspective about the vanishing point: scale d/(d+δ), pulled towards the centre), rushes forward with the motion's
 * overshoot (it pops slightly past its plane) and settles facing the camera. Titles, the hero and numbers arrive
 * letter by letter; pins and logos drop from the same depth.
 */
export const meta = defineMeta({
  id: 'z-arrive',
  axis: 'reveal',
  layer: 'dom',
  label: 'Z arrive',
  needs: { chars: true },
  params: {
    lead: { min: 0, max: 0.5, default: 0.2, label: 'Start before landing (s)' },
    duration: { min: 0.2, max: 1.5, default: 0.45, label: 'Flight duration (s)' },
    depth: { min: 1, max: 20, default: 7, label: 'Start depth behind the plane (focal lengths)' },
    stagger: { min: 0, max: 0.12, default: 0.035, label: 'Letter stagger (s)' },
    spin: { min: 0, max: 60, default: 14, label: 'Spin on the way in (deg)' },
  },
});
