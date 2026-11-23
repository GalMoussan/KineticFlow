import { backOut, easeInOut, expo } from '@reel/runtime';
import { defineMotion } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineMotion({
  meta,
  curves: ({ params }) => ({
    enter: expo,
    bounce: (k, c) => backOut(k, c * params.overshoot),
    exit: (k) => k * k,
    inOut: easeInOut,
  }),
});
