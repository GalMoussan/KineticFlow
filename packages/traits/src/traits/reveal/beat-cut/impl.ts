import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import type { BeatData, BeatSection } from '../../../lib/beat.ts';
import { meta } from './meta.ts';

const PUNCH = 0.18;

/** Scale punch (and a skew snap on emphasis) decaying through the motion's entrance curve. */
function punch(u: Unit, e: number, amp: number): void {
  const big = u.emphasis || u.tags.numeric ? 2 : 1;
  const s = 1 + amp * big * (1 - e);
  u.ch.isx *= s;
  u.ch.isy *= s;
  if (big > 1) u.ch.iskx += (1 - e) * -10;
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    const d = u.data.layout as BeatData | undefined;
    u.data.reveal = { anim: d?.kind ?? 'row' };
    if (d?.kind === 'solo' && Number.isFinite(u.at)) u.hit = { t: u.at, amp: u.font.size / 14 };
  },
  frame({ section, params }, t) {
    const st = section.data.layout as BeatSection;
    const m = section.motion;
    const solos = section.units.filter((u) => (u.data.layout as BeatData | undefined)?.kind === 'solo');
    const wipe = (row: number) => clamp01((t - st.stackT - row * params.stagger) / params.wipe);
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.layout as BeatData | undefined;
      if (!d) continue;
      const c = u.ch;
      switch (d.kind) {
        case 'solo': {
          const i = solos.indexOf(u);
          const end = Math.min(solos[i + 1]?.at ?? Infinity, st.stackT);
          c.visible &&= t >= u.at && t < end;
          if (c.visible) punch(u, m.enter(clamp01((t - u.at) / PUNCH)), params.punch);
          break;
        }
        case 'panel':
          c.visible &&= t < st.stackT;
          break;
        case 'band':
        case 'row': {
          const k = wipe(d.row);
          c.visible &&= k > 0;
          c.clip = Math.min(c.clip, Math.min(1, m.enter(k)));
          c.clipFrom = d.row % 2 ? 'end' : 'start';
          // the unit that lands straight into the recap (no solo beat of its own) punches there
          if (d.kind === 'row' && Math.abs(u.at - st.stackT) < 1e-6) punch(u, m.enter(clamp01((t - u.at) / PUNCH)), params.punch);
          break;
        }
      }
    }
  },
  /** An impact on every solo landing (harder on emphasis/numbers); the recap wipes in with a swipe and an impact. */
  sounds({ section, params }) {
    const st = section.data.layout as BeatSection;
    const out: SoundCue[] = endcardStinger(section);
    let i = 0;
    for (const u of section.units) {
      const d = u.data.layout as BeatData | undefined;
      if (d?.kind !== 'solo' || !(u.at < st.stackT)) continue;
      out.push({ t: u.at, kind: 'impact', weight: u.emphasis || u.tags.numeric ? 0.75 : 0.55, pitch: Math.min(6, i++) });
    }
    const rows = section.units.filter((u) => (u.data.layout as BeatData | undefined)?.kind === 'band').length;
    out.push({ t: st.stackT, kind: 'impact', weight: 0.7 });
    out.push({ t: st.stackT, until: st.stackT + params.wipe + rows * params.stagger, kind: 'swipe', weight: 0.4 });
    return out;
  },
});
