import { clamp01 } from '@reel/runtime';
import { defineCamera, type Layer, type Section, type View } from '../../../contract.ts';
import { chatOf, type ScrollKey } from '../../../lib/chat.ts';
import { meta } from './meta.ts';

interface Key extends ScrollKey {
  s: Section;
}

const keysOf = new WeakMap<Layer, Key[]>();

export default defineCamera({
  meta,
  setup({ layer }) {
    const keys = layer.sections.flatMap((s) => chatOf(s).keys.map((k) => ({ ...k, s })));
    keysOf.set(layer, keys.sort((a, b) => a.t - b.t));
  },
  /**
   * Starts on the first stop; every stop eases from wherever the camera is when it starts (a list burst starts the
   * next stop before the previous one has arrived) along its section's transition (`camera-move`, no dip).
   */
  view({ host, layer }, t) {
    const keys = keysOf.get(layer)!;
    const at = (y: number): View => ({ x: host.safe.cx, y: host.safe.cy + y, r: 0, s: 1 });
    let from = at(keys[0]!.y);
    let move: Key | null = null;
    const pos = (tt: number) => (move ? move.s.travel(from, at(move.y), clamp01((tt - move.t) / move.d)) : from);
    for (const k of keys) {
      if (k.t > t) break;
      from = pos(k.t);
      move = k;
    }
    return pos(t);
  },
  /** The scroll at any t in the window follows from every stop that has started by its end. */
  fingerprint({ layer }, _t0, t1) {
    return keysOf
      .get(layer)!
      .filter((k, i) => i === 0 || k.t < t1)
      .map(({ t, d, y }) => ({ t, d, y }));
  },
});
