import type { SoundCue } from '@reel/core';
import { clamp01, quart } from '@reel/runtime';
import { defineReveal } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

interface Data {
  anim: 'rise' | 'count' | 'scale';
  /** Count-up target (count only). */
  value: number;
}

const DIGIT = /^\p{Nd}$/u;
/** Ticks voiced per count-up. */
const TICKS = 4;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.kind === 'logos') {
      u.data.reveal = { anim: 'scale', value: 0 } satisfies Data;
      return;
    }
    const digits = u.text.replace(/\D/gu, '');
    if ((u.kind === 'stat' || u.kind === 'countdown') && digits) {
      u.split = 'grapheme';
      u.data.reveal = { anim: 'count', value: Number(digits) } satisfies Data;
      return;
    }
    u.data.reveal = { anim: 'rise', value: 0 } satisfies Data;
  },
  frame({ section, params }, t) {
    const m = section.motion;
    const D = params.duration;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.reveal as Data;
      const c = u.ch;
      const S = u.font.size || u.box.h;
      const st = u.at - params.lead;
      c.visible &&= t >= st;
      if (d.anim === 'scale') {
        const k = clamp01((t - st) / (D * 1.2));
        const s = Math.max(0.001, m.bounce(k, 1.5));
        c.sx *= s;
        c.sy *= s;
        c.opacity *= clamp01(k * 3);
        continue;
      }
      const words = d.anim === 'rise' ? u.parts : [];
      const stg = words.length > 1 ? Math.min(0.07, 0.3 / (words.length - 1)) : 0;
      const rise = (k: number) => {
        const e = m.enter(k);
        return { ty: (1 - e) * params.rise * S, o: clamp01(k * 2.2), b: k < 1 ? (1 - e) * 6 * params.blur : 0 };
      };
      if (words.length) {
        for (const p of words) {
          const r = rise(clamp01((t - st - p.index * stg) / D));
          p.ch.ty += r.ty;
          p.ch.opacity *= r.o;
          p.ch.blur += r.b;
        }
      } else {
        const r = rise(clamp01((t - st) / D));
        c.ity += r.ty;
        c.opacity *= r.o;
        c.blur += r.b;
      }
      if (d.anim === 'count') {
        const k = clamp01((t - st) / params.count);
        if (k >= 1) continue;
        const shown = String(Math.round(d.value * quart(k)));
        const ds = u.parts.filter((p) => DIGIT.test(p.text));
        // right-aligned into the digit slots; leading slots stay empty while the number is short
        ds.forEach((p, i) => {
          const j = shown.length - (ds.length - i);
          p.ch.glyph = j >= 0 ? shown[j]! : '';
        });
      }
    }
  },
  /** A soft pop per landing, pitch rising through the section; ticks while a number counts up. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.75);
    let k = 0;
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || u.item < 0 || !Number.isFinite(u.at)) continue;
      const d = u.data.reveal as Data;
      const pan = host.pan(u);
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, pan);
        if (c) out.push(c);
        continue;
      }
      const st = u.at - params.lead;
      if (d.anim === 'count') {
        for (let i = 1; i <= TICKS; i++) out.push({ t: st + (params.count * i) / (TICKS + 1), kind: 'tick', weight: 0.35, pitch: i, pan });
        out.push({ t: st + params.count, kind: 'pop', weight: 0.6, pitch: 5, pan });
      } else out.push({ t: u.at, kind: 'pop', weight: u.tags.hero || u.emphasis ? 0.5 : 0.32, pitch: Math.min(7, k++), pan });
    }
    return out;
  },
});
