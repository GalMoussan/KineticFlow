import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

/** Sub words grow into place at their own landing (uniform scale from SUB_FROM) while they fade up, over SUB_SPAN s. */
const SUB_FROM = 0.86;
const SUB_SPAN = 0.3;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item >= 0 && u.text) u.split = 'none';
  },
  frame({ section, params }, t) {
    const t0 = section.window?.t0 ?? 0;
    const k = section.motion.enter(clamp01((t - t0) / params.fade));
    for (const u of section.units) {
      if (!u.revealed) continue;
      let o = k;
      if (u.item >= 0 && u.kind === 'sub') {
        const ks = section.motion.enter(clamp01((t - (u.at - 0.06)) / SUB_SPAN));
        const s = SUB_FROM + (1 - SUB_FROM) * ks;
        o *= ks;
        u.ch.sx *= s;
        u.ch.sy *= s;
      }
      u.ch.opacity *= o;
      u.ch.visible &&= o > 0.004;
    }
  },
  /** The camera whooshes the zoom. This locks the frame as the section arrives, ticks each sub word, plus the end-card stinger. */
  sounds({ host, section }) {
    const cues: SoundCue[] = endcardStinger(section);
    const t = Math.max(section.timing.in, 0.62);
    if (t < section.timing.holdEnd) cues.push({ t, kind: 'shimmer', weight: 0.28, section: section.id });
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || u.item < 0 || u.kind !== 'sub' || !Number.isFinite(u.at)) continue;
      const c = subLanding(u.at, si++, host.pan(u));
      if (c) cues.push(c);
    }
    return cues;
  },
});
