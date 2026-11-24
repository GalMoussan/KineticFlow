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
    const inn = section.timing.in;
    // The first credit's `in` is 0: it has to be visible while it rises in from below.
    const dur = section.index === 0 ? Math.min(0.22, params.fade) : params.fade;
    const start = section.index === 0 ? 0 : inn - dur;
    const k = section.motion.enter(clamp01((t - start) / Math.max(0.05, dur)));
    for (const u of section.units) {
      if (!u.revealed) continue;
      u.ch.opacity *= k;
      u.ch.visible &&= k > 0.004;
    }
  },
  /** One lock as the credit arrives, never during the music's fade-in. The layout owns the roll whooshes. */
  sounds({ section }) {
    const cues: SoundCue[] = endcardStinger(section);
    const t = Math.max(section.timing.in, 0.62);
    if (t < section.timing.holdEnd) cues.push({ t, kind: 'pop', weight: 0.32, pitch: 1, section: section.id });
    return cues;
  },
});
