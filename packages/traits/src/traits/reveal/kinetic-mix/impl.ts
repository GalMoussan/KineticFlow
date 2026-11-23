import { clamp01, lerp } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { meta } from './meta.ts';

type Anim = 'mask' | 'slide' | 'drop' | 'scale' | 'letters' | 'slot';
const EMPHASIS: Anim[] = ['scale', 'drop', 'letters'];
const MASKED: Partial<Record<Anim, true>> = { mask: true, slide: true, letters: true, slot: true };

function choose(u: Unit): Anim {
  if (u.deco === 'pin' || u.tags.hero) return 'drop';
  if (u.kind === 'date' || u.kind === 'stat' || u.kind === 'countdown') return 'slot';
  if (u.kind === 'weekday' || u.kind === 'city' || u.tags.align === 'start') return 'slide';
  if (u.tags.ordinal >= 0) return EMPHASIS[u.tags.ordinal % 3]!;
  return 'mask';
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    const anim = choose(u);
    u.data.reveal = { anim };
    u.masked = !!MASKED[anim];
    u.innerOrigin = '50% 60%';
    if (anim === 'letters' || anim === 'slot') u.split = 'grapheme';
  },
  frame({ section, params }, t) {
    const m = section.motion;
    const startSide = section.dir === 'rtl' ? 1 : -1; // +x is the start edge in RTL
    for (const u of section.units) {
      if (!u.revealed) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const c = u.ch;
      const st = u.at - params.lead;
      c.visible &&= t >= st;
      if (t < st) continue;
      const e = m.enter(clamp01((t - st) / params.duration));
      switch (anim) {
        case 'mask':
          c.ity += (1 - e) * u.box.h;
          break;
        case 'slide':
          c.itx += (1 - e) * u.box.w * 0.85 * startSide;
          break;
        case 'drop':
          c.ity -= (1 - m.bounce(clamp01((t - st) / 0.42), 1.6)) * u.font.size * 0.55;
          c.opacity *= clamp01((t - st) * 8);
          break;
        case 'scale': {
          const s = lerp(1.45, 1, e);
          c.isx *= s;
          c.isy *= s;
          c.irot += lerp(-5, 0, e);
          c.opacity *= clamp01((t - st) * 7);
          break;
        }
        case 'letters':
          u.parts.forEach((p, i) => {
            p.ch.ty += (1 - m.enter(clamp01((t - st - i * 0.05) / 0.42))) * u.box.h;
          });
          break;
        case 'slot':
          u.parts.forEach((p, i) => {
            p.ch.ty -= (1 - m.bounce(clamp01((t - st - i * 0.06) / 0.45), 1.2)) * u.box.h;
          });
          break;
      }
    }
  },
});
