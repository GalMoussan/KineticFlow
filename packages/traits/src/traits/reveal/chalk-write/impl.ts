import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

type Params = { pace: number; min: number; max: number };

/**
 * The stroke runs from `st` for `d` s, centred on the landing, and is done before the hold. The small line under the
 * big words writes quicker (a lighter hand).
 */
function plan(s: Section, u: Unit, p: Params): { st: number; d: number } {
  const n = Math.max(1, u.graphemes || u.text.length);
  const q = u.kind === 'sub' ? 0.6 : 1;
  let d = Math.min(q * p.max, Math.max(q * p.min, q * n * p.pace));
  let st = u.at - 0.5 * d;
  const room = s.timing.holdStart - 0.04 - st;
  if (d > room) {
    d = Math.max(0.12, room);
    st = Math.min(st, s.timing.holdStart - 0.04 - d);
  }
  return { st, d };
}

export default defineReveal({
  meta,
  prepare({ section }, u) {
    u.split = 'none';
    // write from the word's own reading start, also for an LTR run inside a Hebrew line
    u.data.reveal = { from: (section.dir === 'rtl') === !u.ltr || !u.text ? 'start' : 'end' };
  },
  frame({ section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const c = u.ch;
      const { st, d } = plan(section, u, params);
      const k = clamp01((t - st) / d);
      c.visible &&= t >= st;
      if (!c.visible) continue;
      if (!u.text || u.kind === 'logos') {
        const e = m.enter(k);
        c.opacity *= e;
        c.sx *= 1.08 - 0.08 * e;
        c.sy *= 1.08 - 0.08 * e;
        continue;
      }
      // a hand's pace: quick in the middle of a word, slower at its ends
      const w = k < 1 ? 0.04 + 0.96 * (k * k * (3 - 2 * k)) : 1;
      if (w < 1) {
        c.clip = Math.min(c.clip, w);
        c.clipFrom = (u.data.reveal as { from: 'start' | 'end' }).from;
      }
      c.opacity *= 0.75 + 0.25 * clamp01((t - st - d) / 0.4 + 1);
    }
  },
  /** One scratch per word as long as its stroke; numbers and the hero a little louder; a light tick per sub word. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.75);
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at) || u.item < 0) continue;
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, host.pan(u));
        if (c) out.push(c);
        continue;
      }
      const { st, d } = plan(section, u, params);
      if (st < 0.6) continue;
      if (!u.text) out.push({ t: st + d, kind: 'pop', weight: 0.3, pan: host.pan(u) });
      else out.push({ t: st, until: st + d, kind: 'swipe', weight: u.tags.hero || u.tags.numeric ? 0.42 : 0.3, pan: host.pan(u) });
    }
    return out;
  },
});
