import { backOut, easeInOut } from '@reel/runtime';
import { defineMotion } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Back-out constant of a plain entrance at `overshoot = 1`: a short undershoot-and-settle, not a wobble. */
const ENTER_C = 1.2;

export default defineMotion({
  meta,
  curves: ({ params }) => ({
    enter: (k) => backOut(k, ENTER_C * params.overshoot),
    bounce: (k, c) => backOut(k, c * params.overshoot),
    exit: (k) => k * k * k,
    inOut: easeInOut,
  }),
});
