import type { SoundCue } from '@reel/core';
import { defineReveal } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { bandTimes, smoothstep, span01 } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item >= 0 && u.text) u.split = 'none';
  },
  frame({ section }, t) {
    const w = bandTimes(section.timing.in, section.timing.holdStart, section.window);
    const k = smoothstep(span01(t, w.fade0, w.fade1));
    const on = t < section.timing.out && k > 0.004;
    for (const u of section.units) {
      if (!u.revealed) continue;
      u.ch.visible &&= on;
      u.ch.opacity *= k;
    }
  },
  sounds({ section, params }) {
    const w = bandTimes(section.timing.in, section.timing.holdStart, section.window);
    const cues: SoundCue[] = endcardStinger(section);
    const from = Math.max(w.scroll0, 0.62);
    if (params.whoosh > 0 && w.scroll1 - from >= 0.15) {
      cues.push({ t: from, until: w.scroll1, kind: 'whoosh', weight: params.whoosh, section: section.id });
    }
    if (params.lock > 0 && w.scroll1 >= 0.62) {
      cues.push({ t: w.scroll1, kind: 'impact', weight: params.lock, section: section.id });
    }
    return cues;
  },
});
