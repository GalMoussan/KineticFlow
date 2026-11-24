import { clamp01 } from '@reel/runtime';
import { defineMotion } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineMotion({
  meta,
  curves: ({ params }) => {
    const p = params.power;
    const out = (k: number) => 1 - Math.pow(1 - clamp01(k), p);
    return {
      enter: out,
      bounce: out,
      exit: (k) => Math.pow(clamp01(k), p),
      inOut: (k) => {
        const x = clamp01(k);
        return x < 0.5 ? Math.pow(2 * x, p) / 2 : 1 - Math.pow(2 - 2 * x, p) / 2;
      },
    };
  },
});
