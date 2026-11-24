/**
 * Tilt-up reveal. A word lying back by α about its horizontal ink-bottom axis spans the world plane (x̂, ê2(α)),
 * ê2 = (0, cos α, −sin α); the camera already maps the section plane (x̂, ŷ) through L, so the exact inner map is
 * N = L⁻¹ · Q · [x̂ ê2] (identity at α = 0). Glyphs take only its scale part (`affine(N).sx/sy`, about the ink
 * bottom; letters about their bottom edge), not its shear: Chromium draws sheared or rotated glyphs from its glyph
 * atlas with filtering that depends on what was drawn before (3/255 in `dev/stills.ts` checks (b)/(c)); the brief
 * squash of a tilt stays within 1/255 there. Pins and logos drop in.
 */
import type { SoundCue } from '@reel/core';
import { affine, clamp01 } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { digitParts, endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { det2, edgeOn, inv2, mul2, planeMap, rig, type Mat2, type Proj } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

type Anim = 'word' | 'letters' | 'drop';
const FLAT = 88; // degrees lying back at the start
const C = 1.4; // bounce overshoot
const LAND = 1 / (C + 1); // back-out first reaches 1 here (k), at overshoot 1
const FRONT: Proj = { x: [1, 0, 0], y: [0, 1, 0] };

function choose(u: Unit, role: string): Anim {
  if (u.deco === 'pin' || !u.text) return 'drop';
  if (u.tags.hero || u.tags.numeric || role === 'title' || role === 'cta') return 'letters';
  if (u.tags.ordinal >= 0) return u.tags.ordinal % 2 ? 'word' : 'letters';
  return 'word';
}

export default defineReveal({
  meta,
  prepare({ section, params }, u) {
    const anim = choose(u, section.role);
    u.data.reveal = { anim };
    if (anim === 'letters') u.split = 'grapheme';
    const ink = u.inkBox;
    if (ink) u.innerOrigin = `${(ink.x + ink.w / 2).toFixed(2)}px ${(ink.y + ink.h).toFixed(2)}px`;
    if (u.tags.hero) u.hit = { t: u.at - params.lead + LAND * params.duration, amp: u.font.size / 14 };
  },
  frame({ host, layer, section, params }, t) {
    const m = section.motion;
    const q = rig(layer).proj?.(t) ?? FRONT;
    const L = planeMap(q, [1, 0, 0], [0, 1, 0]);
    const Li: Mat2 = Math.abs(det2(L)) > 1e-3 ? inv2(L) : [1, 0, 0, 1];
    /** Inner map of a plane lying back by `deg`. */
    const tilt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return mul2(Li, planeMap(q, [1, 0, 0], [0, Math.cos(a), -Math.sin(a)]));
    };
    for (const u of section.units) {
      if (!u.revealed) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const c = u.ch;
      const st = u.at - params.lead;
      c.visible &&= t >= st;
      if (t < st) continue;
      if (anim === 'drop') {
        const k = clamp01((t - st) / (0.8 * params.duration));
        c.ity -= (1 - m.bounce(k, 1.6)) * (u.font.size || host.H * 0.1) * 0.9;
        c.opacity *= clamp01(k * 8);
        continue;
      }
      // glyphs get only the scale part of N (see the header): the projected height, about the ink bottom
      if (anim === 'word') {
        const k = clamp01((t - st) / params.duration);
        const a = affine(...tilt(FLAT * (1 - m.bounce(k, C))));
        c.isx *= a.sx;
        c.isy *= Math.abs(a.sy);
        c.opacity *= clamp01(k * 6);
        c.visible &&= !edgeOn(a);
        continue;
      }
      for (const p of u.parts) {
        const k = clamp01((t - st - p.index * params.stagger) / params.duration);
        const a = affine(...tilt(FLAT * (1 - m.bounce(k, C))));
        const sy = Math.abs(a.sy);
        p.ch.ty += (p.h / 2) * (1 - sy);
        p.ch.sx *= a.sx;
        p.ch.sy *= sy;
        p.ch.opacity *= edgeOn(a) ? 0 : clamp01(k * 6);
      }
    }
  },
  /** Heroes thud as they stand (their `hit`), other words pop with rising pitch, digits tick, pins/logos pop low. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    let k = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const st = u.at - params.lead;
      const pan = host.pan(u);
      const land = st + LAND * params.duration;
      if (u.hit) out.push({ t: u.hit.t, kind: 'impact', weight: sizeWeight(u, host.H, 0.45), pan });
      else if (anim === 'drop') out.push({ t: st + LAND * 0.8 * params.duration, kind: 'pop', weight: 0.5, pitch: -3, pan });
      else if (u.tags.numeric) {
        digitParts(u)
          .slice(0, 4)
          .forEach((p, j) => out.push({ t: land + p.index * params.stagger, kind: 'tick', weight: 0.42, pitch: 2 * j, pan }));
      } else out.push({ t: land, kind: 'pop', weight: u.emphasis ? 0.55 : 0.38, pitch: Math.min(7, 2 * k++), pan });
    }
    return out;
  },
});
