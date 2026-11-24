import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import type { StackData, StackUnit } from '../../layout/list-stack/impl.ts';
import { meta } from './meta.ts';

/** The stack row a unit belongs to, or -1 when the layout is not a stack. */
const rowOf = (u: Unit): number => {
  const d = u.data.layout as StackUnit | undefined;
  return typeof d?.row === 'number' ? d.row : -1;
};

export default defineReveal({
  meta,
  frame({ section, params }, t) {
    const m = section.motion;
    const D = params.duration;
    const data = section.data.layout as Partial<StackData> | undefined;
    const rows = data?.rows ?? [];
    const push = (at: number) => m.bounce(clamp01((t - at + params.lead) / D), params.overshoot);
    // each row's offset: the pushes still to come below it (its own entrance included), bottom-up
    const offset = new Array<number>(rows.length).fill(0);
    let acc = 0;
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r]!;
      if (row.fixed) continue;
      acc += row.step * (1 - push(row.at));
      offset[r] = acc;
    }
    for (const u of section.units) {
      if (!u.revealed) continue;
      const r = rowOf(u);
      const at = r >= 0 && rows[r] ? rows[r]!.at : u.at;
      const st = at - params.lead;
      const k = clamp01((t - st) / D);
      const c = u.ch;
      c.visible &&= t >= st;
      c.opacity *= clamp01(k * 4);
      if (r >= 0 && rows[r]) c.ty += offset[r]!;
      else c.ty += (1 - m.enter(k)) * 0.3 * (u.font.size || u.box.h);
      if (u.deco === 'num') {
        const q = clamp01((t - st - 0.1) / 0.35);
        const s = params.slam + (1 - params.slam) * m.bounce(q, 1.8);
        c.visible &&= q > 0;
        c.isx *= s;
        c.isy *= s;
      }
    }
  },
  /** A swipe per push, a pop per row landing (numbered rows louder, pitch rising), a stinger on the end card. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.85);
    const data = section.data.layout as Partial<StackData> | undefined;
    const rows = data?.rows ?? [];
    rows.forEach((row, r) => {
      if (row.fixed || !Number.isFinite(row.at)) return;
      const u = section.units.find((x) => x.item >= 0 && rowOf(x) === r);
      const pan = u ? host.pan(u) : 0;
      const numbered = section.units.some((x) => x.deco === 'num' && rowOf(x) === r);
      if (r > 0) out.push({ t: row.at - params.lead, until: row.at - params.lead + params.duration, kind: 'swipe', weight: 0.22, pan });
      out.push({ t: row.at, kind: 'pop', weight: numbered ? 0.55 : 0.38, pitch: Math.min(7, r), pan });
    });
    if (!rows.length) {
      for (const u of section.units) if (u.item >= 0 && Number.isFinite(u.at)) out.push({ t: u.at, kind: 'pop', weight: 0.35, pan: host.pan(u) });
    }
    // nothing in the first 0.6 s: the music is still fading in there (sfx gate)
    return out.filter((c) => c.t >= 0.6 || c.kind === 'stinger');
  },
});
