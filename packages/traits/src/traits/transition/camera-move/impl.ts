import { defineTransition } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineTransition({
  meta,
  /** In-out travel; scale interpolates in log space and dips (pulls back) mid-move, more on a 90° turn. */
  move({ section, params }, a, b, k) {
    const e = section.motion.inOut(k);
    const dip = Math.abs(b.r - a.r) > 45 ? params.turnDip : params.dip;
    return {
      x: a.x + (b.x - a.x) * e,
      y: a.y + (b.y - a.y) * e,
      r: a.r + (b.r - a.r) * e,
      s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e) * (1 - dip * Math.sin(Math.PI * e)),
    };
  },
});
