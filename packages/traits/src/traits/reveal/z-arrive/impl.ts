/**
 * Z-arrive reveal. A point p of a word δ focal lengths behind its plane (which the camera sees at distance d) is
 * drawn, relative to the plane, at F + k·(p − F) with k = d/(d + δ) and F the vanishing point in group coordinates:
 * outer channels (whole words) or part channels (letters, staggered). δ = depth · (1 − enter(k)), so a back-out motion
 * carries the word a little past its plane before it settles. Units without text drop from the same depth.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineReveal, type Unit } from '../../../contract.ts';
import { digitParts, endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { originPx, rig } from '../../../lib/spatial.ts';
import { meta } from './meta.ts';

type Anim = 'word' | 'letters';

const choose = (u: Unit, role: string): Anim =>
  u.text && (u.tags.hero || u.tags.numeric || role === 'title' || role === 'cta') ? 'letters' : 'word';

export default defineReveal({
  meta,
  prepare({ section }, u) {
    const anim = choose(u, section.role);
    u.data.reveal = { anim };
    if (anim === 'letters') u.split = 'grapheme';
    if (u.tags.hero) u.hit = { t: u.at, amp: u.font.size / 12 };
  },
  frame({ host, layer, section, params }, t) {
    const m = section.motion;
    const d = Math.max(0.2, rig(layer).dist?.(t) ?? 1);
    const fx = host.safe.cx - section.place.x;
    const fy = host.safe.cy - section.place.y;
    /** Perspective factor and opacity of something `k` (0..1) into its flight. */
    const fly = (k: number) => {
      const delta = Math.max(-0.35 * d, params.depth * (1 - m.enter(k)));
      return { s: d / (d + delta), o: clamp01(k * 5) };
    };
    for (const u of section.units) {
      if (!u.revealed) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const c = u.ch;
      const st = u.at - params.lead;
      c.visible &&= t >= st;
      if (t < st) continue;
      if (anim === 'word') {
        const k = clamp01((t - st) / params.duration);
        const f = fly(k);
        const [ox, oy] = originPx(u);
        c.tx += (fx - ox) * (1 - f.s);
        c.ty += (fy - oy) * (1 - f.s);
        c.sx *= f.s;
        c.sy *= f.s;
        c.rot += (1 - clamp01(m.enter(k))) * params.spin * (hash(u.id + 0.3) < 0.5 ? -1 : 1);
        c.opacity *= f.o;
        continue;
      }
      const bx = u.box.x + u.textAt.x;
      const by = u.box.y + u.textAt.y;
      for (const p of u.parts) {
        const k = clamp01((t - st - p.index * params.stagger) / params.duration);
        const f = fly(k);
        p.ch.tx += (fx - (bx + p.x + p.w / 2)) * (1 - f.s);
        p.ch.ty += (fy - (by + p.y + p.h / 2)) * (1 - f.s);
        p.ch.sx *= f.s;
        p.ch.sy *= f.s;
        p.ch.rot += (1 - clamp01(m.enter(k))) * params.spin * 2 * (p.index % 2 ? 1 : -1);
        p.ch.opacity *= f.o;
      }
    }
  },
  /** Landings: the hero thuds (its hit), numbers tick per digit, other words pop with rising pitch. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    let k = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const pan = host.pan(u);
      if (u.hit) out.push({ t: u.hit.t, kind: 'impact', weight: sizeWeight(u, host.H, 0.45), pan });
      else if (u.tags.numeric && u.parts.length) {
        digitParts(u)
          .slice(0, 4)
          .forEach((p, j) => out.push({ t: u.at + p.index * params.stagger, kind: 'tick', weight: 0.4, pitch: 2 * j, pan }));
      } else out.push({ t: u.at, kind: 'pop', weight: u.emphasis ? 0.55 : 0.36, pitch: Math.min(7, 2 * k++), pan });
    }
    return out;
  },
});
