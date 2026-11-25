import type { SoundCue } from '@reel/core';
import { defineReveal } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { bandHold, bandTimes, smoothstep, span01 } from '../../../lib/scroll.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

/** A sub word wipes in from its reading start (like a ticker line) at its own landing, over SUB_SPAN s. */
const SUB_SPAN = 0.26;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item >= 0 && u.text) u.split = 'none';
  },
  frame({ section }, t) {
    const w = bandTimes(section.timing.in, bandHold(section), section.window);
    const k = smoothstep(span01(t, w.fade0, w.fade1));
    const on = t < section.timing.out && k > 0.004;
    for (const u of section.units) {
      if (!u.revealed) continue;
      u.ch.visible &&= on;
      u.ch.opacity *= k;
      if (u.item >= 0 && u.kind === 'sub') {
        const a = Math.max(u.at - 0.06, w.fade1);
        const ks = smoothstep(span01(t, a, a + SUB_SPAN));
        u.ch.clip = Math.min(u.ch.clip, ks);
        u.ch.clipFrom = 'start';
        u.ch.opacity *= Math.min(1, 0.3 + ks);
        u.ch.visible &&= ks > 0.004;
      }
    }
  },
  sounds({ host, section, params }) {
    const w = bandTimes(section.timing.in, bandHold(section), section.window);
    const cues: SoundCue[] = endcardStinger(section);
    const from = Math.max(w.scroll0, 0.62);
    if (params.whoosh > 0 && w.scroll1 - from >= 0.15) {
      cues.push({ t: from, until: w.scroll1, kind: 'whoosh', weight: params.whoosh, section: section.id });
    }
    if (params.lock > 0 && w.scroll1 >= 0.62) {
      cues.push({ t: w.scroll1, kind: 'impact', weight: params.lock, section: section.id });
    }
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || u.item < 0 || u.kind !== 'sub' || !Number.isFinite(u.at)) continue;
      const c = subLanding(u.at, si++, host.pan(u));
      if (c) cues.push(c);
    }
    return cues;
  },
});
