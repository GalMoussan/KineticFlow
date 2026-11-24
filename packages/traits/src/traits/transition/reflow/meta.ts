import { defineMeta } from '../../../contract.ts';

/**
 * Both layers stay on screen through the window (the incoming one on top, its background fading in): the layouts
 * themselves carry the change (outgoing content leaves, tiles and lines re-flow from the previous section's
 * geometry into the new one). A whoosh spans the window.
 */
export const meta = defineMeta({
  id: 'reflow',
  axis: 'transition',
  layer: 'dom',
  label: 'Re-flow (layouts carry the change)',
  scope: 'layer',
  params: {
    whoosh: { min: 0, max: 1, default: 0.45, label: 'Whoosh loudness (0 = silent)' },
  },
});
