import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

interface Data {
  anim: 'track' | 'fade' | 'rule';
  /** Row centre (group px) and final tracking; from the layout's `data.layout` when it provides them. */
  cx: number;
  track: number;
}

/** The unit's ink centre in group px. */
const inkCx = (u: Unit) => u.box.x + (u.inkBox ? u.textAt.x + u.inkBox.x + u.inkBox.w / 2 : u.box.w / 2);

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.deco === 'rule') {
      u.data.reveal = { anim: 'rule', cx: 0, track: 0 } satisfies Data;
      return;
    }
    const row = u.data.layout as { cx?: number; track?: number } | undefined;
    const text = !!u.text && u.kind !== 'logos';
    if (text) u.split = 'grapheme';
    u.data.reveal = { anim: text ? 'track' : 'fade', cx: row?.cx ?? inkCx(u), track: row?.track ?? 0 } satisfies Data;
  },
  frame({ section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.reveal as Data;
      const c = u.ch;
      const st = u.at - (u.item < 0 ? 0 : params.lead);
      c.visible &&= t >= st;
      if (d.anim === 'rule') {
        const k = clamp01((t - st) / params.rule);
        c.sx *= m.inOut(k);
        c.opacity *= clamp01(k * 3);
        continue;
      }
      const k = clamp01((t - st) / params.duration);
      const e = m.enter(k);
      const fade = clamp01((t - st) / params.fade);
      const blur = k < 1 ? (1 - e) * params.blur : 0;
      if (d.anim === 'fade' || !u.parts.length) {
        c.opacity *= fade;
        c.ity += (1 - e) * 0.08 * u.box.h;
        c.blur += blur;
        continue;
      }
      const ox = u.box.x + u.textAt.x;
      const spread = params.spread * (1 - e);
      for (const p of u.parts) {
        const dx = ox + p.x + p.w / 2 - d.cx;
        // the final tracking is a whole-pixel offset, so held letters never sit on sub-pixel positions
        p.ch.tx += Math.round(dx * d.track) + dx * spread;
        p.ch.opacity *= fade;
        p.ch.blur += blur;
      }
    }
  },
  /** A quiet shimmer as each row starts tracking in, a soft pop for the hero and the badge, a gentle stinger. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.6);
    const rows = new Set<number>();
    let k = 0;
    for (const u of section.units) {
      if (!u.revealed || u.item < 0 || !Number.isFinite(u.at)) continue;
      const st = u.at - params.lead;
      const pan = host.pan(u);
      if (u.kind === 'logos') out.push({ t: st + 0.3, kind: 'pop', weight: 0.3, pan });
      else if (!rows.has(u.tags.line)) {
        rows.add(u.tags.line);
        out.push({ t: st, kind: 'shimmer', weight: 0.26, pitch: Math.min(7, k++), pan });
      }
      if (u.tags.hero) out.push({ t: st + 0.35, kind: 'pop', weight: 0.3, pitch: 5, pan });
    }
    // nothing in the first 0.6 s: the music is still fading in there (sfx gate)
    return out.filter((c) => c.t >= 0.6 || c.kind === 'stinger');
  },
});
