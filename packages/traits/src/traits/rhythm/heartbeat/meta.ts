import { defineMeta } from '../../../contract.ts';

/**
 * Heartbeat: no stage kicks (hold text stays still); the section pulse other traits read (`section.pulse`) is a
 * double thump per beat of the cue sheet's grid, lub on the beat and a softer dub `gap` of a beat later.
 */
export const meta = defineMeta({
  id: 'heartbeat',
  axis: 'rhythm',
  layer: 'dom',
  label: 'Heartbeat pulse',
  params: {
    gap: { min: 0.1, max: 0.5, default: 0.28, label: 'Dub after the lub (beats)' },
    dub: { min: 0, max: 1, default: 0.65, label: 'Dub strength (× the lub)' },
    decay: { min: 4, max: 40, default: 16, label: 'Thump decay (1/s)' },
  },
});
