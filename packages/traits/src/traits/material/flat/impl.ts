import { clamp01 } from '@reel/runtime';
import { defineMaterial } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Emphasis treatments rotate with the reveal's (scale · drop + swipe · letters): the second one gets a swipe. */
const swiped = (ordinal: number) => ordinal >= 0 && ordinal % 3 === 1;

export default defineMaterial({
  meta,
  prepare({ host }, u) {
    if (u.item < 0) return; // decorations are coloured by their creators
    u.color = u.tags.hero
      ? host.accent(4)
      : u.tags.ordinal >= 0
        ? swiped(u.tags.ordinal)
          ? host.palette.text
          : host.accent(0)
        : u.tags.align === 'end' || u.kind === 'time' || u.kind === 'city'
          ? host.accent(1)
          : host.palette.text;
  },
  setup({ host, section, params }) {
    if (!params.swipes) return;
    for (const u of [...section.units]) {
      if (u.item < 0 || !swiped(u.tags.ordinal) || !u.inkBox) continue;
      const S = u.font.size;
      const inkLeft = u.box.x + u.textAt.x + u.inkBox.x;
      const ia = u.baseline - (u.box.y + u.textAt.y + u.inkBox.y);
      const sw = host.deco(section, {
        deco: 'swipe',
        cls: 'swipe',
        z: -2,
        at: u.at + 0.15,
        origin: section.dir === 'rtl' ? '100% 50%' : '0 50%',
        box: { x: inkLeft - 0.07 * S, y: u.baseline - ia * 0.58, w: u.inkBox.w + 0.14 * S, h: ia * 0.58 + 0.1 * S },
        style: { background: host.accent(2) },
      });
      sw.data.material = { swipe: true };
    }
  },
  frame({ section, params }, t) {
    for (const u of section.units) {
      if (u.deco !== 'swipe' || !u.data.material) continue;
      const q = section.motion.enter(clamp01((t - u.at) / 0.38));
      u.ch.visible &&= q > 0;
      u.ch.rot += params.tilt;
      u.ch.sx *= q;
    }
  },
});
