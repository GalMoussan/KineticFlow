import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal } from '../../../contract.ts';
import { growFromBaseline, innerBaseline } from '../../../lib/eq.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

/** Letters of a unit settle within this long after its first letter starts, whatever their count. */
const SPREAD = 0.3;

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.data.reveal = { anim: 'rise' };
    if (u.text) u.split = 'grapheme';
    else u.origin = '50% 100%';
  },
  frame({ section, params }, t) {
    const m = section.motion;
    const rtl = section.dir === 'rtl';
    const ex = exitWindow(section);
    for (const u of section.units) {
      if (!u.revealed) continue;
      const st = u.at - params.lead;
      u.ch.visible &&= t >= st;
      if (t < st) continue;
      const n = u.parts.length;
      if (!n) {
        const e = Math.max(0, m.bounce(clamp01((t - st) / params.duration), 1.4));
        const q = ex && t >= ex.t0 ? m.exit(clamp01((t - ex.t0) / (ex.t1 - ex.t0))) : 0;
        u.ch.sx *= e * (1 - q);
        u.ch.sy *= e * (1 - q);
        continue;
      }
      const yb = innerBaseline(u);
      const stg = n > 1 ? Math.min(params.stagger, SPREAD / (n - 1)) : 0;
      // from the start edge: visual order, reversed in RTL
      const order = [...u.parts].sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
      order.forEach((p, i) => {
        const k = clamp01((t - st - i * stg) / params.duration);
        if (k <= 0) {
          p.ch.opacity = 0;
          return;
        }
        growFromBaseline(p, Math.max(0.001, m.bounce(k, 1.6)), yb);
        if (ex && t >= ex.t0) {
          const d = ex.t1 - ex.t0;
          const s2 = Math.min(stg, (0.5 * d) / Math.max(1, n - 1));
          const q = m.exit(clamp01((t - ex.t0 - (n - 1 - i) * s2) / Math.max(0.05, d - (n - 1) * s2)));
          if (q >= 1) p.ch.opacity = 0;
          else growFromBaseline(p, 1 - q, yb);
        }
      });
    }
  },
  /** The exit is drawn inside the window opened by the next section (`section.next`, timing: fingerprinted). */
  fingerprint({ section }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? ex : null;
  },
  /** A pop per unit as its bars top out (pitch rising through the section); a soft swipe down on the power-off. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    let n = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      out.push({ t: u.at - params.lead + 0.6 * params.duration, kind: 'pop', weight: u.emphasis || u.tags.numeric ? 0.6 : 0.45, pitch: Math.min(9, 2 * n++), pan: host.pan(u) });
    }
    const ex = exitWindow(section);
    if (ex) out.push({ t: ex.t0, until: ex.t1, kind: 'swipe', weight: 0.35, pitch: -5 });
    return out;
  },
});
