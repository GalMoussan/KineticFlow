import { defineMeta } from '../../../contract.ts';

/**
 * Turntable: the planar-3D world turns by 90° about its vertical axis in every transition window (eased), so each
 * section's side of the world comes round to face the viewer; while a section holds it sways by a few degrees. The 2D
 * view stays the identity: layouts that place units on 3D faces (iso-blocks, card decks) read the turn from the rig.
 */
export const meta = defineMeta({
  id: 'turntable',
  axis: 'camera',
  layer: 'dom',
  label: 'Turntable (90° per section)',
  params: {
    step: { min: 0, max: 180, default: 90, label: 'Turn per section (deg)' },
    sway: { min: 0, max: 8, default: 2, label: 'Hold sway (deg)' },
  },
});
