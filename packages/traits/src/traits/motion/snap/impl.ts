import { defineMotion } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineMotion({
  meta,
  curves: ({ params }) => {
    const n = Math.max(1, Math.round(params.steps));
    /** 0 before the move, then n equal jumps; the last one lands exactly on 1 (no overshoot, no settle). */
    const step = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : Math.ceil(k * n - 1e-9) / n);
    return { enter: step, bounce: step, exit: step, inOut: step };
  },
});
