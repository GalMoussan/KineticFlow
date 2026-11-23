import { defineMeta } from '../../../contract.ts';

/**
 * The beat grid drives pulses: `section.pulse(t)` is 1 on every beat once the section's last item has landed
 * (decaying), for shapes that throb on the beat; an optional small stage kick follows the same pulse.
 */
export const meta = defineMeta({
  id: 'beat-pulse',
  axis: 'rhythm',
  layer: 'dom',
  label: 'Beat pulse',
  params: {
    kick: { min: 0, max: 0.03, default: 0.004, label: 'Stage zoom per beat' },
    decay: { min: 1, max: 20, default: 10, label: 'Pulse decay (1/s)' },
  },
});
