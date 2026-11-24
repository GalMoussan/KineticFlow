import { clamp01 } from '@reel/runtime';
import { defineCamera } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineCamera({
  meta,
  range: ({ params }) => [1, 1 + params.push],
  view({ host, layer, params }, t) {
    const s = layer.sections.find((x) => t < x.timing.out) ?? layer.sections.at(-1)!;
    const k = clamp01((t - s.timing.in) / Math.max(1e-6, s.timing.out - s.timing.in));
    return { x: host.safe.cx, y: host.safe.cy, r: 0, s: 1 + params.push * k * k * (3 - 2 * k) };
  },
});
