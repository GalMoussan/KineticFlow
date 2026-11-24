import { defineMaterial, type Unit } from '../../../contract.ts';
import { meta } from './meta.ts';

/** Emphasised textual units are inverted onto a block. */
const inverted = (u: Unit) => u.emphasis && !u.tags.hero && !u.tags.numeric && u.kind !== 'logos';

export default defineMaterial({
  meta,
  prepare({ host, section, params }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    u.color = u.tags.hero || u.tags.numeric ? host.accent(0, section) : params.blocks && inverted(u) ? section.palette.bg : section.palette.text;
  },
  /** Blocks from the frame's start edge (bled; padded ink only when not first in its row) behind the inverted units; they move with them. */
  setup({ host, section, params }) {
    if (!params.blocks) return;
    const rtl = section.dir === 'rtl';
    for (const u of [...section.units]) {
      if (u.item < 0 || !inverted(u) || !u.inkBox) continue;
      const S = u.font.size;
      const x0 = u.box.x + u.textAt.x + u.inkBox.x;
      const y0 = u.box.y + u.textAt.y + u.inkBox.y;
      const x1 = x0 + u.inkBox.w;
      const pad = 0.12 * S;
      // bled to the frame's start edge only by the row's start-most unit; others get a padded ink block
      const lead = !section.units.some(
        (v) => v !== u && v.item >= 0 && v.tags.line === u.tags.line && (rtl ? v.box.x > u.box.x : v.box.x < u.box.x),
      );
      const box = !lead
        ? { x: x0 - pad, y: y0 - 0.08 * S, w: u.inkBox.w + 2 * pad, h: u.inkBox.h + 0.16 * S }
        : rtl
        ? { x: x0 - pad, y: y0 - 0.08 * S, w: host.W * 1.05 - (x0 - pad), h: u.inkBox.h + 0.16 * S }
        : { x: -0.05 * host.W, y: y0 - 0.08 * S, w: x1 + pad + 0.05 * host.W, h: u.inkBox.h + 0.16 * S };
      const b = host.deco(section, { deco: 'block', box, style: { background: section.palette.text }, z: -0.5 });
      b.data.material = { of: section.units.indexOf(u) };
    }
  },
  frame({ section }) {
    for (const u of section.units) {
      const d = u.data.material as { of: number } | undefined;
      if (u.item >= 0 || !d) continue;
      const src = section.units[d.of]!.ch;
      u.ch.visible &&= src.visible;
      u.ch.clip = Math.min(u.ch.clip, src.clip);
      u.ch.clipFrom = src.clipFrom;
      u.ch.tx += src.tx;
      u.ch.ty += src.ty;
      u.ch.opacity *= src.opacity;
    }
  },
});
