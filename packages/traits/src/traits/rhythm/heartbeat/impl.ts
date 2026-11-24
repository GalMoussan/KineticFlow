import { defineRhythm } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineRhythm({
  meta,
  /** lub + dub of the last beat at or before t (beat length from the grid, the last one beyond its end). */
  pulse({ host, params }, t) {
    const b = host.reel.cues.beats;
    let i = -1;
    for (let lo = 0, hi = b.length - 1; lo <= hi; ) {
      const mid = (lo + hi) >> 1;
      if (b[mid]! <= t) [i, lo] = [mid, mid + 1];
      else hi = mid - 1;
    }
    if (i < 0) return 0;
    const len = i + 1 < b.length ? b[i + 1]! - b[i]! : i > 0 ? b[i]! - b[i - 1]! : 0.6;
    const a = t - b[i]!;
    const d = a - params.gap * len;
    return Math.min(1, Math.exp(-a * params.decay) + (d >= 0 ? params.dub * Math.exp(-d * params.decay) : 0));
  },
});
