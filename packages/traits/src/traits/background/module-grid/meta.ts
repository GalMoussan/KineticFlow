import { defineMeta } from '../../../contract.ts';

/**
 * Flat paper in the palette's background colour with the format's modular grid (`lib/modules.ts` `moduleGrid`)
 * drawn as hairlines and registration crosses, or a dot screen. It fades in over the layer's incoming window, so
 * a `reflow` transition shows the outgoing layer underneath while the layouts carry the change.
 */
export const meta = defineMeta({
  id: 'module-grid',
  axis: 'background',
  layer: 'dom',
  label: 'Paper + module grid',
  params: {
    lines: { min: 0, max: 1, default: 1, label: 'Grid hairlines (0 = none)' },
    dots: { min: 0, max: 1, default: 0, label: 'Dot screen (0 = none)' },
  },
});
