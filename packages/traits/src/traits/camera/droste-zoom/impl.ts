import type { SoundCue } from '@reel/core';
import { clamp01, easeInOut } from '@reel/runtime';
import { defineCamera, type Section } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Scale of this section's own layer. 1 through the whole hold. */
function scaleOf(s: Section, t: number, nest: number): number {
  const inn = s.timing.in;
  const out = s.timing.out;
  if (s.window && t < inn) {
    const k = easeInOut(clamp01((t - s.window.t0) / Math.max(0.05, s.window.t1 - s.window.t0)));
    return Math.exp(Math.log(nest) * (1 - k));
  }
  if (!s.window) {
    const end = Math.min(Math.max(0.45, s.timing.firstLand - 0.05), s.timing.holdStart - 0.05);
    if (t < end) return Math.exp(Math.log(nest) * (1 - easeInOut(clamp01(t / Math.max(0.05, end)))));
  }
  const next = s.next;
  if (next && next.layer !== s.layer && t >= out) {
    const span = Math.max(0.05, next.timing.in - out);
    const k = easeInOut(clamp01((t - out) / span));
    return Math.exp(Math.log(1 / nest) * k);
  }
  return 1;
}

export default defineCamera({
  meta,
  range: () => [1, 1],
  view({ host, layer, params }, t) {
    const s = layer.sections[0]!;
    return { x: host.safe.cx, y: host.safe.cy, r: 0, s: scaleOf(s, t, params.nest) };
  },
  fingerprint({ layer, params }) {
    const s = layer.sections[0]!;
    return { nest: params.nest, inn: s.timing.in, out: s.timing.out, win: s.window, next: s.next?.timing.in ?? null };
  },
  sounds({ layer, params }) {
    if (params.whoosh <= 0) return [];
    const s = layer.sections[0]!;
    const cues: SoundCue[] = [];
    if (s.window && s.window.t0 >= 0.62 && s.window.t1 - s.window.t0 >= 0.15) {
      cues.push({ t: s.window.t0, until: s.window.t1, kind: 'whoosh', weight: params.whoosh, pan: 0 });
    }
    const next = s.next;
    if (next && next.layer !== s.layer && s.timing.out >= 0.62 && next.timing.in - s.timing.out >= 0.15) {
      cues.push({ t: s.timing.out, until: next.timing.in, kind: 'whoosh', weight: params.whoosh * 0.85, pan: 0 });
    }
    return cues;
  },
});
