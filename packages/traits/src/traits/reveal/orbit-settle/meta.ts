import { defineMeta } from '../../../contract.ts';

/**
 * Graphemes ride their row's ring (translate + rotate only, from the measured advances) and settle onto the straight
 * line the layout already set. At the hold the channels are left untouched, so the line is exactly the laid-out
 * ink. Rings draw themselves in over the same entrance.
 */
export const meta = defineMeta({
  id: 'orbit-settle',
  axis: 'reveal',
  layer: 'dom',
  label: 'Orbit then settle',
  needs: { chars: true },
  requires: { layout: ['orbit-ring'] },
  params: {
    travel: { min: 0.3, max: 1.6, default: 0.85, label: 'Seconds to settle onto the line' },
    sweep: { min: 0.15, max: 0.9, default: 0.5, label: 'How far around the ring the line starts (turns)' },
    exit: { min: 0.1, max: 1, default: 0.45, label: 'Exit back along the ring (s)' },
  },
});
