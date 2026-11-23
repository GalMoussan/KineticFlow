/**
 * Neon reveals (port of dilemma-reel `reel9.js` `animateItem`). Lengths are in units of the `duration` param (0.4 s
 * = reel9's timing); distances in em of the unit (`u.font.size`) or in frame heights. RGB split goes to the parts
 * when the unit has parts (a part's text-shadow replaces the inner one), else to the unit; materials scale it.
 */
import { clamp01, hash, lerp } from '@reel/runtime';
import { defineReveal, type Part, type Section, type Unit } from '../../../contract.ts';
import { EXITS, exitWindow } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

type Anim = 'slam' | 'rise' | 'drop' | 'track' | 'pop' | 'scramble' | 'slot';
const EMPHASIS: Anim[] = ['slam', 'pop', 'scramble', 'drop'];
const PARTS: Partial<Record<Anim, true>> = { track: true, pop: true, scramble: true, slot: true };
const REF = 0.4; // `duration` at which the lengths below are reel9's
const EM = 280; // reel9's typical font size: px effects (blur, split) scale with size / EM

function choose(u: Unit, s: Section): Anim {
  if (u.deco === 'pin') return 'drop';
  if (u.kind === 'logos' || !u.text) return 'rise';
  if (u.tags.hero) return 'pop';
  if (u.tags.numeric) return 'slot';
  if (u.kind === 'weekday' || u.kind === 'city' || u.kind === 'list-title') return 'track';
  if (u.tags.ordinal >= 0) return EMPHASIS[u.tags.ordinal % EMPHASIS.length]!;
  if (s.role === 'title' || s.role === 'cta') return 'slam';
  return 'rise';
}

/** Adds an RGB split of `px` to the unit's parts, or to the unit itself when it has none. */
function split(u: Unit, px: number, parts: readonly Part[] = u.parts): void {
  if (px <= 0) return;
  if (u.parts.length) for (const p of parts) p.ch.split += px;
  else u.ch.split += px;
}

export default defineReveal({
  meta,
  prepare({ section, params }, u) {
    const anim = choose(u, section);
    u.data.reveal = { anim };
    if (PARTS[anim] && u.text) u.split = 'grapheme';
    const sp = params.duration / REF;
    const st = u.at - params.lead;
    if (anim === 'slam') u.hit = { t: st + 0.1 * sp, amp: u.font.size / 14 };
    if (anim === 'drop') u.hit = { t: st + 0.26 * sp, amp: u.font.size / 14 };
  },
  frame({ host, section, params }, t) {
    const m = section.motion;
    const sp = params.duration / REF;
    for (const u of section.units) {
      if (!u.revealed) continue;
      const { anim } = u.data.reveal as { anim: Anim };
      const c = u.ch;
      const st = u.at - params.lead;
      c.visible &&= t >= st;
      if (t < st) continue;
      const dt = t - st;
      const S = u.font.size;
      const px = S / EM;
      switch (anim) {
        case 'slam': {
          const k = clamp01(dt / (0.28 * sp));
          const e = m.enter(k);
          const after = Math.max(0, dt - 0.28 * sp);
          // log-space scale so a back-ease undershoot stays a short punch
          const s = Math.pow(3.2, 1 - e) * (1 + 0.07 * Math.exp(-after * 9) * Math.sin(after * 30));
          c.isx *= s;
          c.isy *= s;
          c.opacity *= clamp01(k * 6);
          c.blur += clamp01(1 - e) * 22 * px;
          split(u, 16 * px * Math.exp(-dt * 5));
          break;
        }
        case 'rise': {
          const k = clamp01(dt / (0.45 * sp));
          const e = m.enter(k);
          c.ity += (1 - e) * 0.6 * (S || host.H * 0.1);
          c.irot += (1 - e) * -4;
          c.opacity *= clamp01(k * 3);
          c.blur += clamp01(1 - e) * 14 * (px || 1);
          break;
        }
        case 'drop': {
          const k = clamp01(dt / (0.42 * sp));
          const e = m.bounce(k, 2.2);
          c.ity -= (1 - e) * host.H * 0.4;
          c.irot += (1 - e) * -18;
          c.opacity *= clamp01(k * 4);
          c.blur += (1 - clamp01(k * 1.3)) * 16 * px;
          const land = dt - 0.3 * sp;
          if (land > 0) split(u, 12 * px * Math.exp(-land * 6));
          break;
        }
        case 'track': {
          const k = clamp01(dt / (0.6 * sp));
          const e = m.enter(k);
          c.opacity *= clamp01(k * 2.5);
          c.blur += clamp01(1 - e) * 16 * px;
          const s = lerp(1.15, 1, e);
          c.isx *= s;
          c.isy *= s;
          // letter-spacing 0.55 em → 0, spreading from the centre in visual order
          const byX = [...u.parts].sort((a, b) => a.x - b.x);
          byX.forEach((p, r) => (p.ch.tx += (r - (byX.length - 1) / 2) * 0.55 * S * (1 - e)));
          break;
        }
        case 'pop': {
          // staggers shrink with the letter count so every letter settles ≈ 0.65 × duration/REF after the start
          const step = Math.min(0.06, 0.25 / Math.max(1, u.parts.length - 1)) * sp;
          u.parts.forEach((p, i) => {
            const kc = clamp01((dt - i * step) / (0.38 * sp));
            const cs = Math.max(0, m.bounce(kc, 2.2));
            p.ch.sx *= cs;
            p.ch.sy *= cs;
            p.ch.rot += (1 - kc) * (hash(i + u.id) - 0.5) * 140;
            p.ch.ty += (1 - kc) * -0.32 * S;
            p.ch.opacity *= clamp01(kc * 4);
            split(u, 12 * px * Math.exp(-Math.max(0, dt - i * step) * 6), [p]);
          });
          break;
        }
        case 'scramble': {
          const step = Math.min(0.08, 0.2 / Math.max(1, u.parts.length - 1)) * sp;
          u.parts.forEach((p, i) => {
            const kc = clamp01((dt - i * step) / (0.45 * sp));
            const e = m.enter(kc);
            p.ch.tx += (1 - e) * (hash(i * 3 + 1 + u.id) - 0.5) * 1.4 * host.W;
            p.ch.ty += (1 - e) * (hash(i * 5 + 2 + u.id) - 0.5) * 0.9 * host.H;
            p.ch.rot += (1 - e) * (hash(i + 9 + u.id) - 0.5) * 900;
            const s = lerp(0.2, 1, e);
            p.ch.sx *= s;
            p.ch.sy *= s;
            p.ch.opacity *= clamp01(kc * 3);
            p.ch.blur += clamp01(1 - e) * 20 * px;
            const settled = dt - i * step - 0.45 * sp;
            split(u, 14 * px * Math.exp(-Math.max(0, settled) * 5) * (kc >= 1 ? 1 : 0.4), [p]);
          });
          break;
        }
        case 'slot': {
          const n = u.parts.length;
          const step = Math.min(0.12, 0.3 / Math.max(1, n)) * sp;
          u.parts.forEach((p, i) => {
            const land = st + 0.22 * sp + i * step;
            const spinning = t < land && /\p{Nd}/u.test(p.text);
            if (spinning) p.ch.glyph = String(Math.floor(hash(Math.floor(t * 30) * 7 + i * 13) * 10));
            const kin = clamp01((dt - i * 0.05 * sp) / (0.2 * sp));
            p.ch.opacity *= clamp01(kin * 4);
            p.ch.ty += (1 - m.enter(kin)) * 0.42 * S;
            if (spinning) {
              p.ch.blur += 7 * px;
              p.ch.ty += Math.sin(t * 90 + i) * 0.05 * S;
            } else if (t >= land) {
              const ka = clamp01((t - land) / (0.22 * sp));
              const s = lerp(1.7, 1, m.enter(ka));
              p.ch.sx *= s;
              p.ch.sy *= s;
              split(u, 14 * px * Math.exp(-(t - land) * 6), [p]);
            }
          });
          break;
        }
      }
    }

    // Exit inside the transition window before the next layer: whip up, zoom through, or fall away.
    const ex = exitWindow(section);
    if (!ex || t < ex.t0) return;
    const ko = clamp01((t - ex.t0) / Math.min(params.exit, ex.t1 - ex.t0));
    const q = m.exit(ko);
    const kind = EXITS[section.index % EXITS.length]!;
    for (const u of section.units) {
      const c = u.ch;
      const px = (u.font.size || 100) / EM;
      if (kind === 'whip') {
        c.ty -= q * host.H * 0.32;
        c.blur += q * 26 * px;
        c.opacity *= 1 - q;
        c.sx *= 1 + q * 0.2;
        c.sy *= 1 + q * 0.2;
      } else if (kind === 'zoom') {
        c.sx *= 1 + q * 1.8;
        c.sy *= 1 + q * 1.8;
        c.blur += q * 22 * px;
        c.opacity *= 1 - ko;
      } else {
        c.ty += q * host.H * 0.3;
        c.rot += q * (hash(u.id + 0.5) - 0.5) * 50;
        c.opacity *= 1 - q;
      }
    }
  },
  /** The exit is drawn by the section's own units, but its window starts at the section's `out` (truthful keys). */
  fingerprint({ section, params }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? { exit: EXITS[section.index % EXITS.length], ...ex, d: Math.min(params.exit, ex.t1 - ex.t0) } : null;
  },
});
