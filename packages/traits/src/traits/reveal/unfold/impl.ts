import type { SoundCue } from '@reel/core';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { foldK, foldWindows } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

/** Emphasis cycles the three dark desk inks. Body stays near-black. Gold is too light on the cream sheet. */
const INKS = ['#C4502B', '#2B6F8A', '#6A4C93'];
const BODY = '#1C1714';

function ink(s: Section, u: Unit): string {
  if (u.tags.hero || u.emphasis) return INKS[s.index % 3]!;
  if (u.tags.numeric) return INKS[(s.index + 1) % 3]!;
  return BODY;
}

function windows(s: Section) {
  return foldWindows(s.timing.in, s.timing.holdStart, s.timing.out, s.window, s.next?.window ?? null);
}

export default defineReveal({
  meta,
  prepare({ section }, u) {
    if (u.item < 0) return;
    if (u.text) u.split = 'none';
    u.color = ink(section, u);
  },
  frame({ section }, t) {
    const w = windows(section);
    const k = foldK(t, w);
    const flat = k >= 1 && !(t >= w.shut0);
    for (const u of section.units) {
      if (!u.revealed) continue;
      u.ch.color = ink(section, u);
      u.ch.visible &&= flat;
      if (!flat) u.ch.opacity *= 0;
    }
  },
  sounds({ section, params }) {
    const w = windows(section);
    const cues: SoundCue[] = endcardStinger(section);
    if (params.swipe > 0 && w.open0 >= 0.62 && w.open1 > w.open0) {
      cues.push({ t: w.open0, until: w.open1, kind: 'swipe', weight: params.swipe, section: section.id });
    }
    if (params.lock > 0 && w.open1 >= 0.62) cues.push({ t: w.open1, kind: 'pop', weight: params.lock, pitch: 2, section: section.id });
    return cues;
  },
});
