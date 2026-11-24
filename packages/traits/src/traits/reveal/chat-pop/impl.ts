import type { SoundCue } from '@reel/core';
import { clamp01, quart } from '@reel/runtime';
import { defineReveal } from '../../../contract.ts';
import { chatOf, chatUnit, POP_DUR, POP_LEAD, scaleAbout } from '../../../lib/chat.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

/** Count-up target of a stat / countdown number. */
interface Count {
  value: number;
}

const DIGIT = /^\p{Nd}$/u;
/** Typing dots: cycles per second, and the share of a cycle a dot spends in the air. */
const DOT_RATE = 2.2;
const DOT_AIR = 0.42;
/** Typing indicator in / out. */
const TYPE_IN = 0.25;
const TYPE_OUT = 0.1;

export default defineReveal({
  meta,
  prepare(_c, u) {
    if (u.item < 0) return;
    const digits = u.text.replace(/\D/gu, '');
    if ((u.kind === 'stat' || u.kind === 'countdown') && digits) {
      u.split = 'grapheme';
      u.data.reveal = { value: Number(digits) } satisfies Count;
    } else u.split = 'none'; // rows are laid out from whole measured items; nothing animates inside a bubble
  },
  frame({ section, params }, t) {
    const cs = chatOf(section);
    const m = section.motion;
    const ty = cs.typing;
    for (const u of section.units) {
      const cu = chatUnit(u);
      if (!cu) continue;
      const c = u.ch;
      if (cu.b < 0) {
        // typing indicator: pops in from its tail, dots hop one after another, gone as the bubble pops
        c.visible &&= !!ty && t >= ty.t0 && t < ty.t1 + TYPE_OUT;
        if (!c.visible || !ty) continue;
        const kin = clamp01((t - ty.t0) / TYPE_IN);
        const kout = clamp01((t - ty.t1) / TYPE_OUT);
        c.opacity *= clamp01(kin * 4) * (1 - kout);
        scaleAbout(u, Math.max(0.001, m.bounce(kin, 1.2) * (1 - 0.4 * kout)), ty.px, ty.py);
        if (cu.part === 'dot') {
          const ph = (t - ty.t0) * DOT_RATE - (cu.i ?? 0) * 0.17;
          const f = ph - Math.floor(ph);
          const air = f < DOT_AIR ? Math.sin((Math.PI * f) / DOT_AIR) : 0;
          c.ty -= air * 0.17 * cs.F;
          c.opacity *= 0.45 + 0.55 * air;
        }
        continue;
      }
      const b = cs.bubbles[cu.b]!;
      const st = b.at - POP_LEAD;
      // tails and avatars move on to the speaker's next bubble
      c.visible &&= t >= st && (cu.until === undefined || t < cu.until);
      if (!c.visible) continue;
      const k = clamp01((t - st) / POP_DUR);
      if (b.kind === 'chip') {
        const e = m.enter(k);
        c.opacity *= clamp01(k * 2.5);
        c.ty -= (1 - e) * 0.45 * cs.F;
        scaleAbout(u, 0.88 + 0.12 * e, b.px, b.py);
      } else {
        c.opacity *= clamp01(k * 5);
        scaleAbout(u, Math.max(0.001, m.bounce(k, params.overshoot * (b.kind === 'card' ? 1.25 : 1))), b.px, b.py);
      }
      const count = u.data.reveal as Count | undefined;
      if (!count) continue;
      const kc = clamp01((t - b.at) / params.count);
      if (kc >= 1) continue;
      const shown = String(Math.round(count.value * quart(kc)));
      const ds = u.parts.filter((p) => DIGIT.test(p.text));
      // right-aligned into the digit slots; leading slots stay empty while the number is short
      ds.forEach((p, i) => {
        const j = shown.length - (ds.length - i);
        p.ch.glyph = j >= 0 ? shown[j]! : '';
      });
    }
  },
  /**
   * One pop per bubble as it lands ("sent" higher than "received", rising through a burst), two very light ticks
   * while the dots type, a soft high pop for the date chip, ticks while a number counts, the stinger on the end card.
   */
  sounds({ host, section, params }) {
    const cs = chatOf(section);
    const out: SoundCue[] = endcardStinger(section, 0.8);
    const unitOf = (b: number, part: string) => section.units.find((u) => chatUnit(u)?.b === b && chatUnit(u)?.part === part);
    const ty = cs.typing;
    if (ty) {
      const pan = host.pan(unitOf(-1, 'typing')!, ty.t1);
      for (let i = 0; i < 2; i++) {
        const t = ty.t0 + 0.2 + i / DOT_RATE;
        if (t >= 0.65 && t < ty.t1 - 0.08) out.push({ t, kind: 'tick', weight: 0.12, pitch: 9 + i, pan });
      }
    }
    cs.bubbles.forEach((b, i) => {
      if (b.kind === 'chip') {
        out.push({ t: b.at, kind: 'pop', weight: 0.3, pitch: 9 });
        return;
      }
      const pan = host.pan(unitOf(i, 'body')!, b.at);
      const weight = b.title || b.kind === 'card' ? 0.55 : 0.45;
      out.push({ t: b.at, kind: 'pop', weight, pitch: (b.side === 'out' ? 4 : -1) + Math.min(4, i), pan });
    });
    for (const u of section.units) {
      if (!u.data.reveal) continue;
      const b = cs.bubbles[chatUnit(u)!.b]!;
      const pan = host.pan(u, b.at);
      for (let i = 1; i <= 3; i++) out.push({ t: b.at + (params.count * i) / 4, kind: 'tick', weight: 0.3, pitch: i, pan });
      out.push({ t: b.at + params.count, kind: 'pop', weight: 0.5, pitch: 6, pan });
    }
    return out;
  },
});
