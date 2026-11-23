import { backOut, expo } from '@reel/runtime';
import { defineMotion } from '../../../contract.ts';
import { meta } from './meta.ts';

const expoIn = (k: number) => (k <= 0 ? 0 : Math.pow(2, 10 * k - 10));
const expoInOut = (k: number) =>
  k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2;

export default defineMotion({
  meta,
  curves: ({ params }) => ({
    enter: expo,
    bounce: (k, c) => (k >= 1 ? 1 : backOut(k, c * params.overshoot)),
    exit: expoIn,
    inOut: expoInOut,
  }),
});
