import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

const FLASH = 0.18;
/** Sub words settle from a slightly larger scale over a longer, softer span (× params.duration). No hit, no flash. */
const SUB_SCALE = 1.08;
const SUB_DUR = 1.4;
const isSub = (u: Unit) => u.item >= 0 && u.kind === 'sub';
const strong = (u: Unit) => u.item >= 0 && !isSub(u) && (u.tags.hero || u.emphasis);

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.split = 'none';
    if (isSub(u)) return;
    if (strong(u) || u.tags.numeric) u.hit = { t: u.at, amp: u.font.size / 14 };
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const st = u.at - params.lead;
      u.ch.visible &&= t >= st;
      if (t < st) continue;
      if (isSub(u)) {
        const k = clamp01((t - st) / (params.duration * SUB_DUR));
        const s = SUB_SCALE + (1 - SUB_SCALE) * m.enter(k);
        u.ch.sx *= s;
        u.ch.sy *= s;
        u.ch.opacity *= clamp01(k * 2.5);
        continue;
      }
      const k = clamp01((t - st) / params.duration);
      const s0 = params.scale * (strong(u) ? 1.25 : 1);
      const s = u.text ? s0 + (1 - s0) * m.enter(k) : Math.max(0.001, m.bounce(k, 1.5));
      u.ch.sx *= s;
      u.ch.sy *= s;
      u.ch.opacity *= clamp01(k * 5);
      if (params.flash > 0 && strong(u) && t >= u.at && t < u.at + FLASH) {
        host.stageCh.flash = Math.max(host.stageCh.flash, params.flash * (1 - (t - u.at) / FLASH));
        host.stageCh.flashColor = section.palette.text;
      }
    }
  },
  /** Stage flashes reach every layer: report the ones alive in the window. */
  fingerprint({ section, params }, t0, t1) {
    if (params.flash <= 0) return null;
    return section.units.filter((u) => strong(u) && u.at < t1 && u.at + FLASH >= t0).map((u) => u.at);
  },
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section);
    let k = 0;
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const pan = host.pan(u);
      if (isSub(u)) {
        const c = subLanding(u.at, si++, pan);
        if (c) out.push(c);
      } else if (u.hit) out.push({ t: u.at, kind: 'impact', weight: sizeWeight(u, host.H, 0.4), pan });
      else out.push({ t: u.at, kind: 'pop', weight: 0.4, pitch: Math.min(7, 2 * k++), pan });
    }
    // nothing in the first 0.6 s: the music is still fading in there (sfx gate)
    return out.filter((c) => c.t >= 0.6 || c.kind === 'stinger');
  },
});
