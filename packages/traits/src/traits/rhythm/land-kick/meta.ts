import { defineMeta } from '../../../contract.ts';

/** Every landing gives the camera a small zoom kick that decays exponentially. */
export const meta = defineMeta({
  id: 'land-kick',
  axis: 'rhythm',
  layer: 'dom',
  label: 'Kick on landings',
  params: {
    kick: { min: 0, max: 0.05, default: 0.008, label: 'Kick zoom per landing' },
    decay: { min: 1, max: 20, default: 6, label: 'Kick decay (1/s)' },
    length: { min: 0.1, max: 2, default: 0.9, label: 'Kick length (s)' },
  },
});
