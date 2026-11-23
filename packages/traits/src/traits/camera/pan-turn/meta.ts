import { defineMeta } from '../../../contract.ts';

/** One camera travels a world: pans or turns from block to block, drifting (zoom + slight roll) while it holds. */
export const meta = defineMeta({
  id: 'pan-turn',
  axis: 'camera',
  layer: 'dom',
  label: 'Pan & turn',
  world: true,
  params: {
    drift: { min: 0, max: 0.2, default: 0.04, label: 'Hold zoom drift' },
    endDrift: { min: 0, max: 1, default: 0.375, label: 'End card drift (× drift)' },
    introZoom: { min: 1, max: 3, default: 1.75, label: 'Intro close-up zoom' },
  },
});
