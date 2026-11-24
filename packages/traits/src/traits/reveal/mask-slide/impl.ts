/**
 * Mask slide: each content unit is masked by its own box and its inner content slides in from the mask edge, from
 * the start edge on even rows and from the top edge on odd ones (`tags.line`), so a stack builds as alternating
 * horizontal and vertical wipes. Rules grow from their origin. Exits (only before a cut to another layer) continue
 * the slide out through the far edge, row by row.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

interface Data {
  anim: 'start' | 'top' | 'rule' | 'show';
  /** Start side in screen x: −1 left (LTR), +1 right (RTL). */
  side: number;
}
/** Exit stagger per row (s). */
const ROW_STEP = 0.05;

const exitOf = (s: Section, exit: number) => {
  const w = exitWindow(s);
  return w ? { t0: w.t0, d: Math.min(exit, 0.6 * (w.t1 - w.t0)) } : null;
};

export default defineReveal({
  meta,
  prepare({ section }, u) {
    const anim: Data['anim'] = u.deco === 'rule' ? 'rule' : u.item < 0 ? 'show' : u.tags.line % 2 === 0 ? 'start' : 'top';
    u.data.reveal = { anim, side: section.dir === 'rtl' ? 1 : -1 } satisfies Data;
    if (anim === 'start' || anim === 'top') u.masked = true;
  },
  frame({ section, params }, t) {
    const m = section.motion;
    const D = params.duration;
    const ex = exitOf(section, params.exit);
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.reveal as Data;
      const c = u.ch;
      const st = u.at - (u.item < 0 ? 0 : params.lead);
      c.visible &&= t >= st;
      const e = m.enter(clamp01((t - st) / D));
      const travel = params.travel;
      if (d.anim === 'rule') c.sx *= e;
      else if (d.anim === 'start') c.itx += (1 - e) * d.side * u.box.w * travel;
      else if (d.anim === 'top') c.ity -= (1 - e) * u.box.h * travel;
      if (!ex || t < ex.t0 || u.item < 0) continue;
      const x = m.exit(clamp01((t - ex.t0 - Math.max(0, u.tags.line) * ROW_STEP) / ex.d));
      if (d.anim === 'start') c.itx -= x * d.side * u.box.w * travel;
      else if (d.anim === 'top') c.ity += x * u.box.h * travel;
    }
  },
  fingerprint({ section, params }, t0, t1) {
    const ex = exitOf(section, params.exit);
    return ex && ex.t0 < t1 && ex.t0 + ex.d + 1 >= t0 ? ex : null;
  },
  /** A soft swipe as each row starts sliding, a pop as an emphasis settles, a print pop for the logo badge. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    const rows = new Set<number>();
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const d = u.data.reveal as Data;
      const st = u.at - (u.item < 0 ? 0 : params.lead);
      const pan = host.pan(u);
      if (d.anim === 'rule') out.push({ t: st, until: st + params.duration, kind: 'swipe', weight: 0.2, pan });
      if (u.item < 0) continue;
      if (u.kind === 'logos') out.push({ t: st + 0.5 * params.duration, kind: 'pop', weight: 0.4, pan });
      else if (!rows.has(u.tags.line)) {
        rows.add(u.tags.line);
        out.push({ t: st, until: st + 0.7 * params.duration, kind: 'swipe', weight: 0.28, pan });
      }
      if (u.emphasis || u.tags.hero) out.push({ t: st + 0.55 * params.duration, kind: 'pop', weight: 0.35, pitch: 2, pan });
    }
    return out;
  },
});
