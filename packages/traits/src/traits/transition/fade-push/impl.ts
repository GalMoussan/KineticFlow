import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineTransition } from '../../../contract.ts';
import { meta } from './meta.ts';

export default defineTransition({
  meta,
  /**
   * Outgoing opacity runs 1 → 0 over [0, (1 + dip) / 2] of the window, incoming 0 → 1 over [(1 − dip) / 2, 1]; both
   * through the section's in-out curve. The push moves content only (the background stays).
   */
  between({ host, section, params }, w, t) {
    const k = clamp01((t - w.t0) / Math.max(1e-6, w.t1 - w.t0));
    const half = (1 + params.dip) / 2;
    const m = section.motion;
    const ko = m.inOut(clamp01(k / half));
    const ki = m.inOut(clamp01((k - (1 - half)) / half));
    const D = params.push * host.safe.h;
    w.outgoing.ch.opacity *= 1 - ko;
    w.outgoing.ch.ty -= D * ko;
    if (ko >= 1) w.outgoing.ch.visible = false;
    w.incoming.ch.opacity *= ki;
    w.incoming.ch.ty += D * (1 - ki);
    if (ki <= 0) w.incoming.ch.visible = false;
  },
  /** One soft swipe across the window (none for empty windows). */
  sounds({ section, params }) {
    const w = section.window;
    if (!w || section.layer.sections[0] !== section || params.sound <= 0 || w.t1 - w.t0 < 0.1) return [];
    return [{ t: w.t0, until: w.t1, kind: 'swipe', weight: params.sound } satisfies SoundCue];
  },
});
