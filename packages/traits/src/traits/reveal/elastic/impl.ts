import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

type Anim = 'drop' | 'jelly' | 'spring';
interface Params {
  fall: number;
  squash: number;
  wobble: number;
  damping: number;
  stagger: number;
  exit: number;
}

function choose(u: Unit): Anim {
  if (u.kind === 'sub') return 'drop';
  if (u.kind === 'logos' || u.tags.numeric || !u.text) return 'spring';
  if ((u.emphasis || u.tags.hero) && u.graphemes > 1) return 'jelly';
  return 'drop';
}

/** Letter stagger of a unit with n parts (the whole word lands within 0.35 s). */
const staggerOf = (n: number, p: Params) => (n > 1 ? Math.min(p.stagger, 0.35 / (n - 1)) : 0);

/**
 * Squash-and-stretch of something landing at `at`: before it, an accelerating fall from `drop` px above, stretched;
 * after it, a damped spring wobble with sx and sy in anti-phase. Returns the offset and the scales.
 */
function land(t: number, at: number, drop: number, p: Params): { dy: number; sx: number; sy: number; o: number } {
  const a = t - at;
  if (a < 0) {
    const k = clamp01(1 + a / p.fall);
    const sy = 1 + 0.45 * p.squash * k;
    return { dy: -(1 - k * k) * drop, sx: 1 / Math.sqrt(sy), sy, o: clamp01(k * 4) };
  }
  const w = Math.exp(-p.damping * a) * Math.cos(p.wobble * a);
  return { dy: 0, sx: 1 + 0.8 * p.squash * w, sy: 1 - p.squash * w, o: 1 };
}

/** Scale spring from 0 (numbers, logos), sx/sy wobbling in anti-phase. */
function spring(t: number, st: number, p: Params): { sx: number; sy: number } {
  const a = t - st;
  if (a <= 0) return { sx: 0, sy: 0 };
  const e = Math.exp(-p.damping * 0.8 * a);
  const s = 1 - e * Math.cos(p.wobble * 0.7 * a);
  const w = 0.5 * p.squash * e * Math.sin(p.wobble * a);
  return { sx: Math.max(0, s * (1 + w)), sy: Math.max(0, s * (1 - w)) };
}

/** Exit: squat, then stretch up and fly off the top. */
function exitOf(s: Section, t: number, u: Unit, p: Params): { dy: number; sx: number; sy: number } | null {
  const x = exitWindow(s);
  if (!x || t < x.t0) return null;
  const k = clamp01((t - x.t0) / Math.min(p.exit, x.t1 - x.t0));
  if (k < 0.3) {
    const q = Math.sin((Math.PI * k) / 0.6);
    return { dy: 0, sx: 1 + 0.18 * q, sy: 1 - 0.22 * q };
  }
  const k2 = (k - 0.3) / 0.7;
  const sy = 1 + 0.6 * k2;
  return { dy: -k2 * k2 * (u.box.y + u.box.h + 300), sx: 1 / Math.sqrt(sy), sy };
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    const anim = choose(u);
    u.data.reveal = { anim };
    if (anim === 'jelly') u.split = 'grapheme';
    const ink = u.inkBox;
    // pivot on the baseline (bottom of the ink), horizontally centred
    if (ink) u.innerOrigin = `${(ink.x + ink.w / 2).toFixed(2)}px ${(ink.y + ink.h).toFixed(2)}px`;
    else u.innerOrigin = '50% 100%';
  },
  frame({ section, params }, t) {
    for (const u of section.units) {
      if (!u.revealed) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const c = u.ch;
      const S = u.font.size || u.box.h;
      const n = u.parts.length;
      const stg = staggerOf(n, params);
      const st = anim === 'spring' ? u.at - 0.12 : u.at - params.fall;
      c.visible &&= t >= st;
      if (anim === 'spring') {
        const { sx, sy } = spring(t, st, params);
        c.isx *= sx;
        c.isy *= sy;
      } else if (u.kind === 'sub') {
        const k = clamp01((t - st) / Math.max(0.05, params.fall));
        const e = section.motion.enter(k);
        c.ity -= (1 - e) * 0.4 * S;
        c.opacity *= e;
      } else if (anim === 'drop' || !n) {
        const l = land(t, u.at, 1.4 * S, params);
        c.ity += l.dy;
        c.isx *= l.sx;
        c.isy *= l.sy;
        c.opacity *= l.o;
      } else {
        for (const pt of u.parts) {
          const l = land(t, u.at + pt.index * stg, 1.6 * S, params);
          if (t < u.at + pt.index * stg - params.fall) pt.ch.opacity = 0;
          pt.ch.ty += l.dy + (pt.h / 2) * (1 - l.sy); // pivot each letter on its bottom
          pt.ch.sx *= l.sx;
          pt.ch.sy *= l.sy;
          pt.ch.opacity *= l.o;
        }
      }
      const x = exitOf(section, t, u, params);
      if (x) {
        c.ity += x.dy;
        c.isx *= x.sx;
        c.isy *= x.sy;
        c.visible &&= x.dy > -(u.box.y + u.box.h + 299);
      }
    }
  },
  /** A pop on every landing (letters of a jelly word: first and last), pitch rising; a whoosh on the exit. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.75);
    let k = 0;
    let si = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const pan = host.pan(u);
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, pan);
        if (c) out.push(c);
        continue;
      }
      if (anim === 'jelly' && u.parts.length > 1) {
        const stg = staggerOf(u.parts.length, params);
        out.push({ t: u.at, kind: 'pop', weight: 0.55, pitch: Math.min(7, k), pan });
        out.push({ t: u.at + (u.parts.length - 1) * stg, kind: 'pop', weight: 0.4, pitch: Math.min(9, k + 3), pan });
      } else out.push({ t: anim === 'spring' ? u.at + 0.02 : u.at, kind: 'pop', weight: u.item < 0 ? 0.3 : 0.45, pitch: Math.min(7, k), pan });
      k++;
    }
    const x = exitWindow(section);
    if (x) out.push({ t: x.t0 + 0.3 * Math.min(params.exit, x.t1 - x.t0), until: x.t1, kind: 'whoosh', weight: 0.45 });
    return out;
  },
});
