import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

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
      u.ch.opacity *= k;
      u.ch.visible &&= k > 0.004;
    }
  },
  /** The camera whooshes the zoom. This only locks the frame as the section arrives, plus the end-card stinger. */
  sounds({ section }) {
    const cues: SoundCue[] = endcardStinger(section);
    const t = Math.max(section.timing.in, 0.62);
    if (t < section.timing.holdEnd) cues.push({ t, kind: 'shimmer', weight: 0.28, section: section.id });
    return cues;
  },
});
