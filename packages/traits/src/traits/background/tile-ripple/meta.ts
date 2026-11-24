import { defineMeta } from '../../../contract.ts';

/**
 * The idle mosaic of a `tile-board` layer: muted accent tiles on the palette's grout over the whole frame. A new
 * layer builds itself in an intro wave (its clip grows cell by cell from a corner or the centre over the outgoing
 * layer, each tile unfolding from edge-on); then on every `every`-th beat a ripple front crosses the frame and every
 * tile it passes flips to its next tone (colour index = ripples passed). Tiles under letters belong to the reveal.
 */
export const meta = defineMeta({
  id: 'tile-ripple',
  axis: 'background',
  layer: 'dom',
  label: 'Tile mosaic ripples',
  requires: { layout: ['tile-board'] },
  params: {
    every: { min: 1, max: 8, default: 2, label: 'Beats per ripple' },
    sweep: { min: 0.4, max: 3, default: 1.1, label: 'Seconds a ripple takes to cross the frame' },
    flip: { min: 0.12, max: 0.6, default: 0.32, label: 'Seconds per tile flip' },
    sound: { min: 0, max: 0.4, default: 0.14, label: 'Ripple shimmer weight while text holds (0 = silent)' },
  },
});
