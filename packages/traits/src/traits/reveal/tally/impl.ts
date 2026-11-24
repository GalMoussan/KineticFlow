import type { SoundCue } from '@reel/core';
import { clamp01, quart } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { digitParts, endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

type Anim = 'count' | 'roll' | 'drop' | 'pop' | 'grow' | 'fade';
interface Data {
  anim: Anim;
  /** Count-up target (count only). */
  value: number;
}

const DIGIT = /^\p{Nd}$/u;
/** Ticks voiced per count-up. */
const TICKS = 4;
/** Delay between rolling digit slots (s). */
const ROLL_STEP = 0.07;
/** Card / mark fade-in (s). */
const FADE = 0.35;

/** Grows with its number: a bar fill starts with the number's lead, other decorations at their own `at`. */
const startOf = (u: Unit, lead: number) => u.at - (u.item >= 0 || u.deco === 'bar-fill' ? lead : 0);

export default defineReveal({
  meta,
  prepare(_c, u) {
    let anim: Anim = 'drop';
    let value = 0;
    if (u.deco === 'bar-fill' || u.deco === 'rule') anim = 'grow';
    else if (u.item < 0) anim = 'fade';
    else if (u.kind === 'logos') anim = 'pop';
    else if ((u.kind === 'stat' || u.kind === 'countdown') && /\d/u.test(u.text)) {
      anim = 'count';
      value = Number(u.text.replace(/\D/gu, ''));
    } else if (u.kind === 'date' || u.kind === 'time') anim = 'roll';
    if (anim === 'count' || anim === 'roll') u.split = 'grapheme';
    u.data.reveal = { anim, value } satisfies Data;
  },
  frame({ section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = u.data.reveal as Data;
      const c = u.ch;
      const S = u.font.size || u.box.h;
      const st = startOf(u, params.lead);
      c.visible &&= t >= st;
      const k = clamp01((t - st) / params.count);
      switch (d.anim) {
        case 'grow':
          c.visible &&= k > 0;
          c.sx *= Math.max(0.001, quart(k));
          break;
        case 'fade':
          c.opacity *= m.enter(clamp01((t - st) / FADE));
          break;
        case 'pop': {
          const s = Math.max(0.001, m.bounce(clamp01((t - st) / (params.duration * 1.2)), 1.5));
          c.sx *= s;
          c.sy *= s;
          break;
        }
        case 'drop': {
          const q = clamp01((t - st) / params.duration);
          c.ity -= (1 - m.bounce(q, 1.6)) * params.drop * S;
          c.opacity *= clamp01(q * 3);
          break;
        }
        case 'count':
        case 'roll': {
          const q = clamp01((t - st) / params.duration);
          c.ity += (1 - m.enter(q)) * 0.18 * S;
          c.opacity *= clamp01(q * 4);
          const ds = u.parts.filter((p) => DIGIT.test(p.text));
          if (d.anim === 'count') {
            if (k >= 1) break;
            const shown = String(Math.round(d.value * quart(k)));
            // right-aligned into the fixed digit slots; leading slots stay empty while the number is short
            ds.forEach((p, i) => {
              const j = shown.length - (ds.length - i);
              p.ch.glyph = j >= 0 ? shown[j]! : '';
            });
            break;
          }
          // every slot spins down onto its digit, one after another
          ds.forEach((p, j) => {
            const kj = clamp01((t - st - j * ROLL_STEP) / (params.count * 0.8));
            if (kj >= 1) return;
            const n = Math.round((10 + 3 * j) * (1 - quart(kj)));
            p.ch.glyph = String((((Number(p.text) - n) % 10) + 10) % 10);
          });
          break;
        }
      }
    }
  },
  /** Ticks through each count and roll, a pop as a number settles, label pops, a riser along each bar. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.8);
    let k = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const d = u.data.reveal as Data;
      const st = startOf(u, params.lead);
      const pan = host.pan(u);
      if (d.anim === 'grow' && u.deco === 'bar-fill') out.push({ t: st, until: st + params.count, kind: 'riser', weight: 0.24, pan });
      if (u.item < 0) continue;
      if (d.anim === 'count') {
        for (let i = 1; i <= TICKS; i++) out.push({ t: st + (params.count * i) / (TICKS + 1), kind: 'tick', weight: 0.32, pitch: i, pan });
        out.push({ t: st + params.count, kind: 'pop', weight: 0.55, pitch: 5, pan });
      } else if (d.anim === 'roll') {
        digitParts(u).slice(0, 4).forEach((_, j) => out.push({ t: st + params.count * 0.8 + j * ROLL_STEP, kind: 'tick', weight: 0.3, pitch: 2 * j, pan }));
      } else if (d.anim === 'pop') out.push({ t: st + 0.25, kind: 'pop', weight: 0.45, pan });
      else out.push({ t: u.at, kind: 'pop', weight: u.emphasis || u.tags.hero ? 0.45 : 0.3, pitch: Math.min(7, k++), pan });
    }
    // nothing in the first 0.6 s: the music is still fading in there (sfx gate)
    return out.filter((c) => c.t >= 0.6 || c.kind === 'stinger');
  },
});
