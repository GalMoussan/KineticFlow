import { defineMeta } from '../../../contract.ts';

/**
 * Perspective fly-through: every section's plane sits `gap` focal lengths deeper than the previous one along one
 * tunnel; the camera flies forward from plane to plane (eased, with a roll), creeps a little while a section holds,
 * and passes through the old plane on the way (it grows past the camera and is fogged out). A plane facing the camera
 * maps to a uniform scale f/d about the vanishing point (the safe area's centre), so each layer's view is exact.
 */
export const meta = defineMeta({
  id: 'fly-through',
  axis: 'camera',
  layer: 'dom',
  label: 'Fly-through (perspective)',
  params: {
    gap: { min: 1, max: 8, default: 3.2, label: 'Depth between section planes (focal lengths)' },
    creep: { min: 0, max: 0.1, default: 0.035, label: 'Forward creep while holding (focal lengths)' },
    settle: { min: 0.1, max: 1.2, default: 0.4, label: 'Arrival after the section starts (s)' },
    roll: { min: 0, max: 30, default: 10, label: 'Roll during a move (deg)' },
    far: { min: 2, max: 12, default: 6, label: 'Fog: fully gone at this distance (focal lengths)' },
  },
});
