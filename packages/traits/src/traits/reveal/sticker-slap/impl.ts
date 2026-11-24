import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineReveal, type Section } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { meta } from './meta.ts';

/** Peel stagger between stickers (s) and the shortest peel. */
const STAGGER = 0.04;
const MIN_PEEL = 0.18;

/** Peel window per sticker j of n: staggered starts, all done by the window's end. */
function peelOf(s: Section, j: number, n: number): { t0: number; d: number } | null {
  const ex = exitWindow(s);
  if (!ex) return null;
  const stg = Math.min(STAGGER, Math.max(0, (ex.t1 - ex.t0 - MIN_PEEL) / Math.max(1, n - 1)));
  return { t0: ex.t0 + j * stg, d: Math.max(0.05, ex.t1 - ex.t0 - (n - 1) * stg) };
}

/** Side a sticker spins/peels to: alternating, seeded by the unit. */
const sideOf = (id: number) => (hash(id * 3 + 2) < 0.5 ? -1 : 1);

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.data.reveal = { anim: 'slap' };
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const stickers = section.units.filter((u) => u.revealed);
    stickers.forEach((u, j) => {
      const c = u.ch;
      const st = u.at - params.lead;
      c.visible &&= t >= st;
      const k = clamp01((t - st) / params.duration);
      const e = Math.max(0, m.bounce(k, 2.4));
      c.sx *= e;
      c.sy *= e;
      const side = sideOf(u.id);
      c.rot += (1 - m.enter(k)) * side * params.spin * (0.6 + 0.4 * hash(u.id));
      if (!params.peel) return;
      const p = peelOf(section, j, stickers.length);
      if (!p || t < p.t0) return;
      const q = clamp01((t - p.t0) / p.d);
      // it lifts off the sheet first (grows, tilts), then curls flat (squashes) and flies off over its side; no skew:
      // skewed text with the rim's shadow layers rasters differently with the seek history (stills check (c))
      const lift = m.inOut(clamp01(q / 0.45));
      const fly = m.exit(clamp01((q - 0.3) / 0.7));
      c.rot += lift * side * 12 + fly * side * 40;
      c.sx *= 1 + 0.08 * lift;
      c.sy *= (1 + 0.08 * lift) * (1 - 0.55 * fly);
      c.ty -= lift * 0.04 * host.H + fly * 0.75 * host.H;
      c.tx += fly * side * 0.25 * host.W;
    });
  },
  /** Peels are reported through `section.next` / the window (both fingerprinted); nothing else to add. */
  fingerprint({ section }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? ex : null;
  },
  /** A pop as each sticker lands (pitch climbing through the section); one swipe for the peel. */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    let n = 0;
    for (const u of section.units) {
      if (!u.revealed || !Number.isFinite(u.at)) continue;
      // back-out first crosses 1 at ≈ 58 % of the slap
      out.push({ t: u.at - params.lead + 0.58 * params.duration, kind: 'pop', weight: u.emphasis || u.tags.hero ? 0.65 : 0.5, pitch: Math.min(9, 2 * n++), pan: host.pan(u) });
    }
    const ex = params.peel ? exitWindow(section) : null;
    if (ex) out.push({ t: ex.t0, until: ex.t1, kind: 'swipe', weight: 0.5 });
    return out;
  },
});
