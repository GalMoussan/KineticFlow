import { defineRhythm, type Section } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Landing times per section (the fingerprint hook reports the ones that reach a window). */
const kicks = new WeakMap<Section, number[]>();

export default defineRhythm({
  meta,
  setup({ section }) {
    kicks.set(
      section,
      section.units.filter((u) => u.item >= 0 && u.kind !== 'logos' && Number.isFinite(u.at)).map((u) => u.at),
    );
  },
  headroom({ section, params }) {
    const ks = kicks.get(section)!;
    let max = 0;
    for (const t of ks) {
      let k = 0;
      for (const a of ks) if (t - a >= 0 && t - a < params.length) k += params.kick * Math.exp(-(t - a) * params.decay);
      max = Math.max(max, k);
    }
    return 1 + max;
  },
  frame({ host, section, params }, t) {
    for (const a of kicks.get(section)!) {
      const d = t - a;
      if (d >= 0 && d < params.length) host.stageCh.kick += params.kick * Math.exp(-d * params.decay);
    }
  },
  fingerprint({ section, params }, t0, t1) {
    return kicks.get(section)!.filter((a) => a > t0 - params.length && a < t1);
  },
});
