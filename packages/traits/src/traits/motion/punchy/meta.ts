import { defineMeta } from '../../../contract.ts';

/** Back-ease entrances with a small undershoot-and-settle; accelerating exits. */
export const meta = defineMeta({
  id: 'punchy',
  axis: 'motion',
  layer: 'dom',
  label: 'Punchy',
  params: { overshoot: { min: 0, max: 3, default: 1, label: 'Overshoot (× each reveal’s own)' } },
});
