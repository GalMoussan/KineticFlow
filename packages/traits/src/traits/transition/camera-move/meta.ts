import { defineMeta } from '../../../contract.ts';

/** Inside a world chain: the camera travels to the next block, pulling back a little on the way. */
export const meta = defineMeta({
  id: 'camera-move',
  axis: 'transition',
  layer: 'dom',
  label: 'Camera move',
  scope: 'world',
  params: {
    dip: { min: 0, max: 0.6, default: 0.22, label: 'Pull-back on a pan' },
    turnDip: { min: 0, max: 0.6, default: 0.38, label: 'Pull-back on a turn' },
  },
});
