/**
 * Count-down slam (see meta). Counting numbers keep their real parts hidden until `u.at`; meanwhile reveal-owned step
 * elements appended to `u.el` (never `u.inner`: QA reads it) show the steps from `lib/countdown.ts`, ink-centred on
 * the number, each punching in with a uniform scale. Every element property set here is rewritten every frame.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, lerp } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { countSteps, stepTimes } from '../../../lib/countdown.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

type Anim = 'count' | 'slam' | 'drop' | 'pop';
interface Data {
  anim: Anim;
  /** count: step texts and their times (the last step ends at `u.at`), launch = the date's 3 · 2 · 1. */
  texts: string[];
  times: number[];
  launch: boolean;
}

/** Step / slam / drop durations (s). */
const PUNCH = 0.16;
const SLAM = 0.26;
const DROP = 0.24;
/** The date's flash: length (s) and decay (1/s). */
const FLASH_LEN = 0.45;
const FLASH_DECAY = 9;
/** No cues while the music fades in. */
const QUIET = 0.6;

const steps = new WeakMap<Unit, HTMLDivElement[]>();
const dataOf = (u: Unit) => u.data.reveal as Data;

export default defineReveal({
  meta,
  prepare({ host, section, params }, u) {
    const data: Data = { anim: 'pop', texts: [], times: [], launch: false };
    u.data.reveal = data;
    const S = u.font.size || u.box.h;
    if (u.deco === 'plate') {
      // shown from the first step of its number
      const of = section.units[(u.data.layout as { of: number }).of]!;
      const d = of.data.reveal as Data | undefined;
      u.at = d?.times[0] ?? of.at;
      return;
    }
    if (u.item < 0 || u.kind === 'logos') return;
    const st = countSteps(u);
    if (st) {
      const { texts, times } = stepTimes(host, section, u, st);
      Object.assign(data, { anim: 'count', texts, times, launch: st.mode === 'launch' });
      u.split = 'grapheme';
      u.hit = { t: u.at, amp: params.shake * S };
      return;
    }
    if (u.kind === 'sub') {
      data.anim = 'drop';
      return;
    }
    if (u.emphasis || u.tags.hero || u.kind === 'time') {
      data.anim = 'slam';
      u.hit = { t: u.at, amp: (params.shake / (u.tags.numeric ? 1.5 : 2.5)) * S };
      return;
    }
    data.anim = 'drop';
  },
  mount({ host, section, params }) {
    for (const u of section.units) {
      const d = u.data.reveal as Data | undefined;
      if (d?.anim !== 'count' || !u.el || !u.inkBox) continue;
      const S = u.font.size;
      const F = d.launch ? S * params.giant : S;
      const cx = u.textAt.x + u.inkBox.x + u.inkBox.w / 2;
      const cy = u.textAt.y + u.inkBox.y + u.inkBox.h / 2;
      const els = d.texts.map((txt) => {
        const m = host.metrics(txt, u.font.weight, true, 'text');
        const ox = ((m.br - m.bl) / 2) * F;
        const oy = F / 2 + ((m.fa - m.fd) * F) / 2 + ((m.id - m.ia) / 2) * F;
        const el = host.el('div', 'count-step', u.el, {
          left: `${(cx - ox).toFixed(2)}px`,
          top: `${(cy - oy).toFixed(2)}px`,
          'font-family': 'var(--textfont), monospace',
          'font-size': `${F.toFixed(2)}px`,
          'font-weight': String(u.font.weight),
          color: section.palette.text,
          'transform-origin': `${ox.toFixed(2)}px ${oy.toFixed(2)}px`,
        });
        el.textContent = txt;
        return el;
      });
      steps.set(u, els);
    }
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const d = dataOf(u);
      const c = u.ch;
      const S = u.font.size || u.box.h;
      switch (d.anim) {
        case 'count': {
          const landed = t >= u.at;
          c.visible &&= t >= (d.times[0] ?? u.at);
          const els = steps.get(u) ?? [];
          els.forEach((el, i) => {
            const t0 = d.times[i]!;
            const on = !landed && t >= t0 && (i + 1 >= els.length || t < d.times[i + 1]!);
            const k = clamp01((t - t0) / PUNCH);
            el.style.display = on ? 'block' : 'none';
            el.style.transform = on ? `scale(${lerp(params.step, 1, m.enter(k)).toFixed(4)})` : 'none';
          });
          for (const p of u.parts) if (!landed) p.ch.opacity = 0;
          if (landed) {
            const k = clamp01((t - u.at) / SLAM);
            const s = lerp(params.slam, 1, m.enter(k));
            c.isx *= s;
            c.isy *= s;
          }
          if (d.launch && landed && t - u.at < FLASH_LEN && params.flash > 0) {
            host.stageCh.flash = Math.max(host.stageCh.flash, params.flash * Math.exp(-(t - u.at) * FLASH_DECAY));
            host.stageCh.flashColor = '#FFFFFF';
          }
          break;
        }
        case 'slam': {
          const st = u.at - 0.05;
          c.visible &&= t >= st;
          const k = clamp01((t - st) / SLAM);
          const s = lerp(params.slam, 1, m.enter(k));
          c.isx *= s;
          c.isy *= s;
          c.opacity *= clamp01(k * 5);
          break;
        }
        case 'drop': {
          const st = u.at - 0.1;
          c.visible &&= t >= st;
          const k = clamp01((t - st) / DROP);
          c.ity -= (1 - m.enter(k)) * 0.45 * S;
          c.opacity *= clamp01(k * 3);
          break;
        }
        case 'pop': {
          const st = u.at - 0.08;
          c.visible &&= t >= st;
          const s = Math.max(0.001, m.bounce(clamp01((t - st) / 0.3), 1.6));
          c.sx *= s;
          c.sy *= s;
          break;
        }
      }
    }
  },
  /** The date flashes reach the stage (and can be off screen in the window's snapshot). */
  fingerprint({ section }, t0, t1) {
    return section.units
      .filter((u) => u.data.reveal && dataOf(u).launch && u.at < t1 && u.at + FLASH_LEN >= t0)
      .map((u) => u.at);
  },
  /**
   * A tick per countdown step, pitch rising towards the landing; an impact on every number slam (the date's with a
   * shimmer for its flash), lighter impacts on word slams, soft pops for plain words, plates are silent.
   */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section);
    let k = 0;
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || u.deco === 'plate' || !Number.isFinite(u.at)) continue;
      const d = dataOf(u);
      const pan = host.pan(u);
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, pan);
        if (c) out.push(c);
        continue;
      }
      if (d.anim === 'count') {
        const n = d.times.length;
        d.times.forEach((ts, i) =>
          out.push({ t: ts, kind: 'tick', weight: (d.launch ? 0.55 : 0.4) + (0.15 * i) / Math.max(1, n - 1), pitch: (d.launch ? 3 : 2) * i, pan }),
        );
        out.push({ t: u.at, kind: 'impact', weight: d.launch ? 0.9 : 0.75, pan });
        if (d.launch) out.push({ t: u.at, kind: 'shimmer', weight: 0.5 });
      } else if (d.anim === 'slam') out.push({ t: u.at, kind: 'impact', weight: u.kind === 'time' ? 0.5 : 0.45, pan });
      else out.push({ t: u.at, kind: 'pop', weight: d.anim === 'pop' ? 0.42 : 0.3, pitch: Math.min(7, k++), pan });
    }
    return out.filter((c) => c.t >= QUIET);
  },
});
