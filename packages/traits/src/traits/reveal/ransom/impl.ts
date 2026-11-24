import type { SoundCue } from '@reel/core';
import { clamp01, hash, lerp } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

type Params = { lead: number; duration: number; stagger: number; spin: number; size: number; exit: number };

/** Letter i of u starts slapping at `st + i · stg` (the stagger shrinks so the last letter lands before the hold). */
function plan(s: Section, u: Unit, p: Params): { st: number; stg: number } {
  const st = u.at - p.lead;
  const n = u.parts.length;
  const room = s.timing.holdStart - 0.04 - st - p.duration;
  return { st, stg: n > 1 ? Math.max(0, Math.min(p.stagger, room / (n - 1))) : 0 };
}

/** Back-out first crosses 1 at ≈ 58 % of the slap: the moment it hits the page. */
const HIT = 0.58;
const side = (k: number) => (hash(k * 3.1 + 0.7) < 0.5 ? -1 : 1);

export default defineReveal({
  meta,
  prepare({ params }, u) {
    if (u.item >= 0 && u.text && u.kind !== 'logos') u.split = 'grapheme';
    u.data.reveal = { anim: 'ransom' };
    if (u.tags.hero) u.hit = { t: u.at - params.lead + HIT * params.duration, amp: u.font.size / 18 };
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const ex = params.exit ? exitWindow(section) : null;
    const units = section.units.filter((u) => u.revealed);
    const total = units.reduce((a, u) => a + Math.max(1, u.parts.length), 0);
    const stgE = ex ? Math.min(0.025, Math.max(0, ex.t1 - ex.t0 - 0.2) / Math.max(1, total - 1)) : 0;
    const dE = ex ? Math.max(0.12, ex.t1 - ex.t0 - (total - 1) * stgE) : 1;
    let g = 0;
    for (const u of units) {
      const c = u.ch;
      const { st, stg } = plan(section, u, params);
      c.visible &&= t >= st;
      const S = u.font.size || host.H * 0.1;
      // the slap: from `size` × and a spin down to rest with the motion's overshoot
      const slap = (k: number, key: number) => {
        const e = Math.max(0, m.bounce(k, 2.2));
        return { s: lerp(params.size, 1, Math.min(1, e)) * (e > 1 ? 1 - 0.25 * (e - 1) : 1), rot: (1 - m.enter(k)) * side(key) * params.spin, o: clamp01(k * 5) };
      };
      // the fling: a hop, then a fall off the bottom of the frame, spinning away
      const fling = (key: number) => {
        if (!ex || t < ex.t0) return null;
        const q = clamp01((t - ex.t0 - g * stgE) / dE);
        const e = m.exit(q);
        return { tx: Math.round(side(key) * e * 0.2 * host.W), ty: Math.round(e * 1.1 * host.H - Math.sin(Math.PI * Math.min(1, q * 2)) * 0.25 * S), rot: side(key) * e * 140 };
      };
      if (!u.parts.length) {
        const a = slap(clamp01((t - st) / params.duration), u.id);
        c.sx *= a.s;
        c.sy *= a.s;
        c.rot += a.rot;
        c.opacity *= a.o;
        const f = fling(u.id);
        if (f) {
          c.tx += f.tx;
          c.ty += f.ty;
          c.rot += f.rot;
        }
        g++;
        continue;
      }
      for (const p of u.parts) {
        const key = u.id * 41 + p.index;
        const k = clamp01((t - st - p.index * stg) / params.duration);
        const a = slap(k, key);
        p.ch.sx *= a.s;
        p.ch.sy *= a.s;
        p.ch.rot += a.rot;
        p.ch.opacity *= k > 0 ? a.o : 0;
        const f = fling(key);
        if (f) {
          p.ch.tx += f.tx;
          p.ch.ty += f.ty;
          p.ch.rot += f.rot;
        }
        g++;
      }
    }
  },
  /** Flings are driven by `section.next` and the window (both fingerprinted). */
  fingerprint({ section, params }, t0, t1) {
    const ex = params.exit ? exitWindow(section) : null;
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? ex : null;
  },
  /** Each word slaps down with a pop (pitch climbing), a few letter ticks inside it, the hero lands as an impact. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    let n = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      const { st, stg } = plan(section, u, params);
      const hit = st + HIT * params.duration;
      const pan = host.pan(u);
      if (u.tags.hero) out.push({ t: hit, kind: 'impact', weight: 0.35 + 0.3 * sizeWeight(u, host.H, 0.1), pan });
      else out.push({ t: hit, kind: 'pop', weight: u.emphasis ? 0.55 : 0.42, pitch: Math.min(8, 2 * n++), pan });
      const letters = u.parts.length;
      for (let i = 2; i < letters && i <= 6; i += 2) out.push({ t: hit + i * stg, kind: 'tick', weight: 0.22, pitch: i, pan });
    }
    const ex = params.exit ? exitWindow(section) : null;
    if (ex) out.push({ t: ex.t0, until: ex.t1, kind: 'whoosh', weight: 0.4 });
    return out;
  },
});
