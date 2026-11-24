import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineCamera, type Host, type Layer } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Camera y at t. Increasing y looks further down the column, so the type travels up the screen. */
function yAt(host: Host, layer: Layer, t: number, enter: number): number {
  const secs = layer.sections;
  const first = secs[0]!;
  const arrive = Math.min(first.timing.holdStart - 0.05, Math.max(0.4, first.timing.firstLand - 0.08));
  if (t <= arrive) {
    const k = first.motion.inOut(clamp01(t / Math.max(0.05, arrive)));
    return first.frame.y - enter * host.H * (1 - k);
  }
  let y = first.frame.y;
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[i]!;
    const b = secs[i + 1]!;
    const t0 = a.timing.out;
    const t1 = Math.max(t0 + 0.05, b.timing.in);
    if (t < t0) return a.frame.y;
    if (t < t1) {
      const k = a.motion.inOut(clamp01((t - t0) / (t1 - t0)));
      return a.frame.y + (b.frame.y - a.frame.y) * k;
    }
    y = b.frame.y;
  }
  return y;
}

export default defineCamera({
  meta,
  view({ host, layer, params }, t) {
    return { x: host.safe.cx, y: yAt(host, layer, t, params.enter), r: 0, s: 1 };
  },
  /** The path is the section frames and their windows. Frames are a fixed pitch, not the date string. */
  fingerprint({ host, layer, params }) {
    const secs = layer.sections;
    return {
      enter: params.enter,
      y: secs.map((s) => Math.round(s.frame.y)),
      move: secs.slice(0, -1).map((s) => [s.timing.out, s.next?.timing.in ?? null]),
      arrive: Math.min(secs[0]!.timing.holdStart - 0.05, Math.max(0.4, secs[0]!.timing.firstLand - 0.08)),
      h: host.H,
    };
  },
  sounds({ layer, params }) {
    if (params.whoosh <= 0) return [];
    const out: SoundCue[] = [];
    for (let i = 0; i < layer.sections.length - 1; i++) {
      const a = layer.sections[i]!;
      const b = layer.sections[i + 1]!;
      if (a.timing.out >= 0.62 && b.timing.in - a.timing.out >= 0.15) {
        out.push({ t: a.timing.out, until: b.timing.in, kind: 'whoosh', weight: params.whoosh, pan: 0 });
      }
    }
    return out;
  },
});
