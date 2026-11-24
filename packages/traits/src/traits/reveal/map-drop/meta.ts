import { defineMeta } from '../../../contract.ts';

/**
 * Cards stay hidden until their section arrives (so a pull-back mid-pan cannot show the next label), then settle.
 * The venue pin drops onto its waypoint and is exactly home once the location has landed.
 */
export const meta = defineMeta({
  id: 'map-drop',
  axis: 'reveal',
  layer: 'dom',
  label: 'Map pin drop',
  requires: { layout: ['map-route'] },
  params: {},
});
