import { defineMeta } from '../../../contract.ts';

/**
 * Vertical dolly for the credits column. The first credit rises into the centre from below, each later credit
 * eases from the previous one's frame to its own between `out` and `in`, and the camera rests on `frame.y` for
 * the hold. No zoom and no roll: the type stays the size it was set at.
 */
export const meta = defineMeta({
  id: 'credits-dolly',
  axis: 'camera',
  layer: 'dom',
  label: 'Credits dolly',
  world: true,
  requires: { layout: ['credits-column'] },
  params: {
    enter: { min: 0.2, max: 1.2, default: 0.72, label: 'Opening rise (× frame height, from below)' },
    whoosh: { min: 0, max: 1, default: 0.4, label: 'Whoosh while rolling to the next credit' },
  },
});
