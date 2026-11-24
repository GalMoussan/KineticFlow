import type { SoundCue } from '@reel/core';
import { defineCamera, type Layer } from '../../../contract.ts';
import { span01, type Stack } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

/**
 * The layer's scroll keys: entry [t0, t1] (from the cut in the middle of the incoming window, or the section start,
 * to just before the first landing) and exit [e0, e1] (from the section's end to the cut into the next layer).
 */
function keys(layer: Layer) {
  const s = layer.sections[0]!;
  const t1 = s.timing.firstLand - 0.04;
  const t0 = Math.min(s.window ? (s.window.t0 + s.window.t1) / 2 : s.timing.in, t1 - 0.1);
  const w = s.next && s.next.layer !== layer ? s.next.window : null;
  return { t0, t1, e0: w ? s.timing.out : Infinity, e1: w ? Math.max(s.timing.out + 0.05, (w.t0 + w.t1) / 2) : Infinity, D: (s.data.layout as Stack).reach };
}

export default defineCamera({
  meta,
  view({ host, layer, params }, t) {
    const k = keys(layer);
    // A last section has no exit window (e0 = e1 = Infinity). clamp01(NaN) stays NaN, and that
    // camera Y poisons host.pan → a silent mix → ffmpeg loudnorm exit 234. span01 treats it as 0.
    const kin = span01(t, k.t0, k.t1);
    const kout = span01(t, k.e0, k.e1);
    const y = host.safe.cy - k.D * Math.pow(1 - kin, params.ramp) + k.D * Math.pow(kout, params.ramp);
    return { x: host.safe.cx, y: Number.isFinite(y) ? y : host.safe.cy, r: 0, s: 1 };
  },
  /** Motion blur ∝ speed (normalised to the ramps' top speed). */
  frame({ layer, params }, t) {
    if (!params.blur) return;
    const k = keys(layer);
    const vin = t >= k.t0 && t < k.t1 ? Math.pow(1 - (t - k.t0) / (k.t1 - k.t0), params.ramp - 1) : 0;
    const vout = t > k.e0 && t <= k.e1 ? Math.pow((t - k.e0) / (k.e1 - k.e0), params.ramp - 1) : 0;
    layer.ch.blur += params.blur * Math.max(vin, vout);
  },
  /** The scroll keys depend on the next section's window. */
  fingerprint({ layer }) {
    const { t0, t1, e0, e1 } = keys(layer);
    return { t0, t1, e0: Number.isFinite(e0) ? e0 : null, e1: Number.isFinite(e1) ? e1 : null };
  },
  /** One whoosh from the start of the incoming window (the outgoing column's ramp-up) to the brake. */
  sounds({ layer, params }) {
    const s = layer.sections[0]!;
    const k = keys(layer);
    const from = s.window ? s.window.t0 : k.t0;
    if (params.whoosh <= 0 || from < 0.6 || k.t1 - from < 0.15) return [];
    return [{ t: from, until: k.t1, kind: 'whoosh', weight: params.whoosh, pan: 0 } satisfies SoundCue];
  },
});
