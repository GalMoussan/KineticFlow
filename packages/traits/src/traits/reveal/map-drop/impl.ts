/**
 * Map pin drop (see meta). The settle writes opacity and ty only while it is in progress, so a hold is the reset
 * identity. The pin's overshoot is local and returns exactly 1 at the end of the drop. Sub words (the card's caption)
 * each drop in at their own time: a short fall of half their height with a fade, no overshoot, one light tick.
 */
import type { SoundCue } from '@reel/core';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

const SETTLE = 0.32;
const DROP = 0.42;
/** Sub word: starts `SUB_LEAD` s before its `at`, falls for `SUB_FALL` s. */
const SUB_LEAD = 0.08;
const SUB_FALL = 0.3;

export default defineReveal({
  meta,
  frame({ host, section }, t) {
    const arrived = t >= section.timing.in;
    for (const u of section.units) {
      if (u.item < 0 && u.deco !== 'card' && u.deco !== 'pin') continue;
      if (!arrived) {
        u.ch.visible = false;
        continue;
      }
      if (u.deco === 'pin') continue;
      if (u.item >= 0 && u.kind === 'sub') {
        subDrop(section, u, t);
        continue;
      }
      const k = (t - section.timing.in) / SETTLE;
      if (k < 1) {
        const e = section.motion.enter(k < 0 ? 0 : k);
        u.ch.opacity = e;
        u.ch.ty += (1 - e) * 16;
      }
    }
    const pin = section.units.find((u) => u.deco === 'pin');
    if (pin && arrived) dropPin(section, pin, t, host.H);
  },
  sounds({ host, section }) {
    const pinSection = section.layer.sections.find((s) => s.role === 'location') ?? section.layer.sections.at(-1);
    const cues: SoundCue[] = [{ t: Math.max(0.6, section.timing.in), kind: 'pop', weight: 0.3, section: section.id }];
    if (section === pinSection) {
      cues.push({ t: Math.max(0.6, section.timing.firstLand), kind: 'impact', weight: 0.62, section: section.id });
    }
    let si = 0;
    for (const u of section.units) {
      if (u.item < 0 || u.kind !== 'sub' || !Number.isFinite(u.at)) continue;
      const c = subLanding(u.at, si++, host.pan(u));
      if (c) cues.push(c);
    }
    cues.push(...endcardStinger(section, 0.7));
    return cues;
  },
});

/** Hidden until its window, then a half-height fall from above with a fade; identity once landed. */
function subDrop(section: Section, u: Unit, t: number): void {
  const k = (t - (u.at - SUB_LEAD)) / SUB_FALL;
  if (k < 0) {
    u.ch.visible = false;
    return;
  }
  if (k >= 1) return;
  const e = section.motion.enter(k);
  u.ch.opacity = e;
  u.ch.ty -= (1 - e) * 0.5 * u.box.h;
}

/** Above the tip until the window, then a cubic fall with a small overshoot that is gone at k = 1. */
function dropPin(section: Section, pin: Unit, t: number, H: number): void {
  const end = section.timing.firstLand;
  const start = Math.max(section.timing.in, end - DROP);
  if (!(end > start)) return;
  const dist = DROP * H;
  if (t >= end) return;
  if (t <= start) {
    pin.ch.ty += -dist;
    return;
  }
  pin.ch.ty += (arrive((t - start) / (end - start)) - 1) * dist;
}

function arrive(k: number): number {
  if (k >= 1) return 1;
  const x = k < 0 ? 0 : k;
  return 1 - (1 - x) ** 3 + Math.sin(x * Math.PI) * (1 - x) * 0.08;
}
