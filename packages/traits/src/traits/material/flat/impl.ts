import { clamp01 } from '@reel/runtime';
import { defineMaterial } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Emphasis treatments rotate with the reveal's (scale · drop + swipe · letters): the second one gets a swipe. */
const swiped = (ordinal: number) => ordinal >= 0 && ordinal % 3 === 1;

/**
 * `marker` multiplied onto `paper`, at 92 % so the paper texture shows through. Stands in for `mix-blend-mode:
 * multiply`, which composites the swipe and, through overlap, every unit above it (README §1).
 */
function multiplied(marker: string, paper: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const rgb = [0, 1, 2].map((i) => Math.round((ch(marker, i) * ch(paper, i)) / 255));
  return `rgba(${rgb.join(', ')}, 0.92)`;
}

export default defineMaterial({
  meta,
  prepare({ host, section }, u) {
    if (u.item < 0) return; // decorations are coloured by their creators
    u.color = u.tags.hero
      ? host.accent(4, section)
      : u.tags.ordinal >= 0
        ? swiped(u.tags.ordinal)
          ? section.palette.text
          : host.accent(0, section)
        : u.tags.align === 'end' || u.kind === 'time' || u.kind === 'city'
          ? host.accent(1, section)
          : section.palette.text;
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
        style: { background: multiplied(host.accent(2, section), section.palette.bg) },
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
