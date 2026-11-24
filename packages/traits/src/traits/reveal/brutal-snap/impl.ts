import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import type { BrutalData } from '../../../lib/brutal.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

const kind = (u: Unit) => (u.data.layout as BrutalData | undefined)?.kind;

/** Flash length of content unit `item`: at most half the gap to the next landing (or to the hold). */
function flashOf(s: Section, item: number, max: number): number {
  const content = s.units.filter((u) => u.item >= 0);
  const u = content[item]!;
  if (u.kind === 'logos' || !s.units.some((g) => kind(g) === 'giant' && (g.data.layout as { of: number }).of === item)) return 0;
  const next = content[item + 1]?.at ?? s.timing.holdStart;
  return Math.max(0, Math.min(max, (next - u.at) / 2));
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.data.reveal = { anim: kind(u) ?? 'row' };
    if (kind(u) === 'giant') u.hit = { t: u.at, amp: 18 };
  },
  frame({ section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.layout as BrutalData | undefined;
      const c = u.ch;
      switch (d?.kind) {
        case 'giant':
        case 'flash': {
          const fl = flashOf(section, d.of, params.flash);
          c.visible &&= t >= u.at && t < u.at + fl;
          break;
        }
        case 'rule': {
          const k = clamp01((t - d.at) / params.rule);
          c.visible &&= k > 0;
          c.sx *= m.inOut(k);
          break;
        }
        case 'label':
        case 'mark':
          c.visible &&= t >= u.at;
          break;
        default: {
          if (u.item < 0) break;
          const st = u.at + flashOf(section, u.item, params.flash);
          const k = clamp01((t - st) / params.cut);
          c.visible &&= t >= st;
          c.clip = Math.min(c.clip, m.enter(k));
          c.clipFrom = 'start';
        }
      }
    }
  },
  /** An impact on every giant flash, a short tick as each row cuts in after it, one tick for the slug bar. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    out.push({ t: section.timing.in, kind: 'tick', weight: 0.35, pitch: -4 });
    for (const u of section.units) {
      if (u.item < 0 || !Number.isFinite(u.at)) continue;
      const fl = flashOf(section, u.item, params.flash);
      if (fl > 0) out.push({ t: u.at, kind: 'impact', weight: u.emphasis || u.tags.numeric ? 0.85 : 0.7 });
      out.push({ t: u.at + fl, kind: 'tick', weight: 0.4, pan: host.pan(u, u.at + fl) });
    }
    return out;
  },
});
