import { clamp01, smooth } from '@reel/runtime';
import { defineCamera, type Layer, type Section, type View } from '../../../contract.ts';
import { meta } from './meta.ts';

/** One camera key: a section's frame (or the intro close-up) held from `arrive` to `leave`. */
interface Key extends View {
  /** Section index, or -1 for the intro key. */
  section: number;
  arrive: number;
  leave: number;
  drift: number;
  end: boolean;
}

const keysOf = new WeakMap<Layer, { keys: Key[]; travel: (Section | null)[] }>();

const driftOf = (s: Section, p: { drift: number; endDrift: number }) => (s.role === 'endcard' ? p.drift * p.endDrift : p.drift);

/** Hold: slow zoom drift across the whole hold, with a slight roll except on the end card. */
function hold(k: Key, t: number): View {
  const u = clamp01((t - k.arrive) / (k.leave - k.arrive));
  return { x: k.x, y: k.y, r: k.r + (k.end || !k.drift ? 0 : 0.5 * (u - 0.5)), s: k.s * (1 - k.drift / 2 + k.drift * smooth(u)) };
}

export default defineCamera({
  meta,
  range({ params }, s) {
    const d = driftOf(s, params);
    return [1 - d / 2, 1 + d / 2];
  },
  setup({ host, layer, params }) {
    const A = layer.sections[0]!;
    const intro = host.reel.cues.cues.find((c) => c.type === 'intro');
    const keys: Key[] = [];
    const travel: (Section | null)[] = [];
    let firstArrive = A.timing.in;
    if (layer.intro && intro && A.index === 0) {
      const leave = intro.t + 0.05;
      keys.push({ section: -1, ...layer.intro, s: layer.intro.s * params.introZoom, arrive: A.timing.in, leave, drift: 0, end: false });
      travel.push(null);
      // The camera leaves the intro close-up, then arrives on the first block just before its first landing.
      firstArrive = Math.min(A.timing.holdStart, Math.max(leave + 0.3, A.timing.firstLand - 0.05));
    }
    for (const s of layer.sections) {
      keys.push({
        section: s.index,
        ...s.frame,
        arrive: s === A ? firstArrive : s.timing.in,
        leave: s.timing.out,
        drift: driftOf(s, params),
        end: s.role === 'endcard',
      });
      travel.push(s);
    }
    keysOf.set(layer, { keys, travel });
  },
  view({ layer }, t) {
    const { keys, travel } = keysOf.get(layer)!;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      if (i > 0 && t < k.arrive) {
        const p = keys[i - 1]!;
        return travel[i]!.travel(hold(p, p.leave), hold(k, k.arrive), clamp01((t - p.leave) / (k.arrive - p.leave)));
      }
      if (t < k.leave || i === keys.length - 1) return hold(k, t);
    }
    return hold(keys.at(-1)!, t);
  },
  /** Keys whose hold overlaps the window, and both keys of every move that does. */
  fingerprint({ layer }, t0, t1) {
    const { keys } = keysOf.get(layer)!;
    const active = new Set<number>();
    const overlaps = (a: number, b: number) => a < t1 && b >= t0;
    keys.forEach((k, i) => {
      if (overlaps(i === 0 ? -Infinity : k.arrive, i === keys.length - 1 ? Infinity : k.leave)) active.add(i);
      if (i > 0 && overlaps(keys[i - 1]!.leave, k.arrive)) active.add(i).add(i - 1);
    });
    return [...active].sort((a, b) => a - b).map((i) => keys[i]);
  },
});
