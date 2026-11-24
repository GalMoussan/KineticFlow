import { defineMeta } from '../../../contract.ts';

/**
 * Text flowing along ribbons (`layout: ribbon-band`): each row's band unrolls from off-frame, then every unit
 * arrives as a train of its measured graphemes riding the band (translate + rotate along the curve, arc-length
 * spacing from the measured advances, never SVG textPath) and brakes onto its place on the straight run, where it
 * holds unrotated. Before the next layer the letters run on and leave along the exit swoop, the band rolling up
 * behind them. A swipe per train, a pop per landing, a whoosh per exit.
 */
export const meta = defineMeta({
  id: 'ribbon-flow',
  axis: 'reveal',
  layer: 'dom',
  label: 'Ribbon flow',
  requires: { layout: ['ribbon-band'] },
  needs: { chars: true },
  params: {
    travel: { min: 0.4, max: 2, default: 0.95, label: 'Train travel time to the landing (s)' },
    draw: { min: 0.3, max: 1.5, default: 0.7, label: 'Band unroll time (s)' },
    exit: { min: 0.2, max: 1.5, default: 0.6, label: 'Exit run time (s, within the next window)' },
  },
});
