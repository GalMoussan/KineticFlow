import { defineMeta } from '../../../contract.ts';

/**
 * Orthographic orbit around each layer's plane of type: every unit is put on the plane z = 0 and seen through a
 * yaw/pitch rotation (exact under parallel projection: one affine map per unit). The camera swings in from the side
 * (revolving-door direction alternating per section), settles to a near-frontal rest pose before the hold, sways a
 * little while it holds and swings on into the next section. Publishes its rig for extrusion and tilt reveals.
 */
export const meta = defineMeta({
  id: 'orbit',
  axis: 'camera',
  layer: 'dom',
  label: 'Orbit (orthographic)',
  params: {
    yaw: { min: -40, max: 40, default: 18, label: 'Rest yaw (deg; > 0 shows right sides)' },
    pitch: { min: -30, max: 30, default: -12, label: 'Rest pitch (deg; > 0 seen from above)' },
    swing: { min: 0, max: 85, default: 68, label: 'Entry/exit swing (deg of yaw)' },
    lift: { min: 0, max: 40, default: 16, label: 'Entry pitch offset (deg)' },
    sway: { min: 0, max: 10, default: 3, label: 'Hold sway (deg)' },
    margin: { min: 1, max: 1.4, default: 1.12, label: 'Layout headroom for the pose (zoom multiplier)' },
  },
});
