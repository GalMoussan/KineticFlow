/**
 * Shapes → letters. Per text unit (plan in `u.data.reveal`): its graphemes pop in as accent circles/squares in
 * reading order, hold, and morph into the grapheme outlines (`lib/morph`, shape = one outer sized to the grapheme;
 * holes and niqqud grow from points), landing as real text. The previous section's letters (drawn by this reveal,
 * its layer is cut away) morph back into shapes that tumble out of the frame. Units without an outline fade.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, lerp } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { circleRing, glyphContours, morph, moveContours, ringsBBox, rectRing, type Contour, type Morph } from '../../../lib/morph/geom.ts';
import { draw, overlay, svgEl, unitOutline, xform } from '../../../lib/morph/page.ts';
import { describe, fit, plainEntrance, prevSource, textUnits } from '../../../lib/morph/reveal.ts';
import { mixHex } from '../../../lib/neon.ts';
import { endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

/** Shape hold between pop and morph (s). */
const HOLD = 0.08;
/** Exit: letters → shapes, then the fall (s). */
const EXIT_MORPH = 0.24;
const EXIT_FALL = 0.5;

interface Plan {
  start: number;
  e: number;
  /** Time factor when the full entrance did not fit before the landing. */
  f: number;
}
interface Letter {
  m: Morph;
  rank: number;
  cx: number;
  cy: number;
  square: boolean;
  color: string;
  el: SVGPathElement;
}
interface Entry {
  u: Unit;
  plan: Plan;
  stag: number;
  letters: Letter[];
}
interface Exit {
  stag: number;
  to: string;
  letters: Letter[];
}
const state = new WeakMap<Section, { entries: Entry[]; exits: Exit[] }>();

/** One shape for a grapheme: a circle or a square centred on its ink, about as big as the letter. */
function shapeOf(cs: readonly Contour[], S: number, square: boolean): { contours: Contour[]; cx: number; cy: number } {
  const [x0, y0, x1, y1] = ringsBBox(cs.map((c) => c.ring));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const d = Math.min(0.8 * S, Math.max(0.34 * S, x1 - x0, y1 - y0)) * (square ? 0.8 : 0.92);
  const ring = square ? rectRing(cx - d / 2, cy - d / 2, d, d) : circleRing(cx, cy, d / 2, 72);
  return { contours: glyphContours([ring]), cx, cy };
}

/** Graphemes in reading order: harfbuzz clusters are visual (left → right); Hebrew reads right → left. */
const rankOf = (j: number, n: number, rtl: boolean) => (rtl ? n - 1 - j : j);
/** Stagger between letters so the whole word spreads over `spread` s (at most 0.06 s apart). */
const staggerOf = (n: number, spread: number) => (n > 1 ? Math.min(0.06, spread / (n - 1)) : 0);

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.split = 'none';
  },
  setup({ section, params }) {
    const L = params.pop + HOLD + params.duration + params.spread;
    const floor = section.window?.t0 ?? 0;
    for (const u of textUnits(section)) {
      const e = Math.min(u.at + 0.05, section.timing.holdStart - 0.05);
      const { start, f } = fit(e, L, floor);
      u.data.reveal = { start, e, f } satisfies Plan;
    }
    const src = prevSource(section);
    section.data.reveal = src ? { prev: src.prev.id, off: src.off, units: textUnits(src.prev).map(describe) } : null;
  },
  async mount({ host, section, params }) {
    const svg = overlay(host, section.group, 'shape-morph');
    const exits: Exit[] = [];
    const entries: Entry[] = [];
    // the previous section's letters first (drawn below this section's shapes)
    const src = prevSource(section);
    for (const su of src ? textUnits(src.prev) : []) {
      const o = await unitOutline(host, su);
      if (!o) continue;
      const n = o.outline.clusters.length;
      const letters = o.outline.clusters.map((cl, j): Letter => {
        const rank = rankOf(j, n, o.script === 'he');
        const moved = moveContours(cl, src!.off[0], src!.off[1]);
        const square = (su.item + rank) % 2 === 1;
        const sh = shapeOf(moved, su.font.size, square);
        return { m: morph(moved, sh.contours), rank, cx: sh.cx, cy: sh.cy, square, color: host.accent(su.item + rank, src!.prev), el: svgEl('path', svg) };
      });
      exits.push({ stag: staggerOf(n, 0.15), to: su.color, letters });
    }
    for (const u of textUnits(section)) {
      const o = await unitOutline(host, u);
      if (!o) continue;
      const n = o.outline.clusters.length;
      const letters = o.outline.clusters.map((cl, j): Letter => {
        const rank = rankOf(j, n, o.script === 'he');
        const square = (u.item + rank) % 2 === 1;
        const sh = shapeOf(cl, u.font.size, square);
        return { m: morph(sh.contours, cl), rank, cx: sh.cx, cy: sh.cy, square, color: host.accent(u.item + rank, section), el: svgEl('path', svg) };
      });
      entries.push({ u, plan: u.data.reveal as Plan, stag: staggerOf(n, params.spread), letters });
    }
    state.set(section, { entries, exits });
  },
  frame({ host, section, params }, t) {
    const st = state.get(section)!;
    const m = section.motion;
    const outlined = new Set(st.entries.map((x) => x.u));
    for (const u of section.units) {
      if (!u.revealed) continue;
      if (outlined.has(u)) u.ch.visible &&= t >= (u.data.reveal as Plan).e;
      else plainEntrance(section, u, t);
    }
    for (const x of st.entries) {
      const { start, e, f } = x.plan;
      const S = x.u.font.size;
      for (const l of x.letters) {
        const p = start + f * l.rank * x.stag;
        const kp = clamp01((t - p) / (f * params.pop));
        const m0 = p + f * (params.pop + HOLD);
        const km = clamp01((t - m0) / (f * params.duration));
        if (t < p || t >= e) {
          draw(l.el, '', '', 0);
          continue;
        }
        const s = Math.max(0, m.bounce(kp, 1.7));
        const ep = m.enter(kp);
        const q = m.inOut(km);
        const spin = l.square ? (1 - ep) * -90 : 0;
        draw(l.el, l.m.path(q), mixHex(l.color, x.u.color, q), 1, xform(0, (1 - ep) * -0.45 * S, spin, s, l.cx, l.cy));
      }
    }
    // the previous section's letters: back into shapes, then they tumble away
    const t0 = section.window?.t0 ?? 0;
    for (const x of st.exits) {
      for (const l of x.letters) {
        const p = t0 + l.rank * x.stag;
        const km = clamp01((t - p) / EXIT_MORPH);
        const kf = clamp01((t - p - EXIT_MORPH * 0.8) / EXIT_FALL);
        if (kf >= 1) {
          draw(l.el, '', '', 0);
          continue;
        }
        const q = m.inOut(km);
        const fall = kf * kf;
        const dir = l.rank % 2 ? 1 : -1;
        draw(
          l.el,
          l.m.path(q),
          mixHex(x.to, l.color, q),
          1 - fall,
          xform(dir * 0.08 * host.W * kf, 0.55 * host.H * fall - 0.05 * host.H * Math.sin(Math.PI * kf), dir * 160 * fall, lerp(1, 0.6, kf), l.cx, l.cy),
        );
      }
    }
  },
  /**
   * A pop as each word's shapes land (pitch rising through the section), a light shimmer as it becomes text, a
   * whoosh as the previous section's shapes tumble away, the end-card stinger.
   */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    const st = state.get(section)!;
    let si = 0;
    st.entries.forEach((x, i) => {
      const { start, e, f } = x.plan;
      const pan = host.pan(x.u, e);
      if (x.u.kind === 'sub') {
        const c = subLanding(e, si++, pan);
        if (c) out.push(c);
        return;
      }
      // detail sounds stay soft: the music fades in under the first ones (sfx gate ≤ +6 dB over the music)
      out.push({ t: start + f * params.pop * 0.6, kind: 'pop', weight: 0.22 + 0.2 * sizeWeight(x.u, host.H, 0.1), pitch: Math.min(7, i), pan });
      out.push({ t: e, kind: 'shimmer', weight: x.u.tags.hero ? 0.5 : 0.22, pan });
    });
    if (section.window && st.exits.length) out.push({ t: section.window.t0, until: section.window.t0 + EXIT_MORPH + EXIT_FALL, kind: 'whoosh', weight: 0.4 });
    const outlined = new Set(st.entries.map((x) => x.u));
    for (const u of section.units) {
      if (!(u.revealed && !outlined.has(u) && Number.isFinite(u.at))) continue;
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, host.pan(u));
        if (c) out.push(c);
      } else out.push({ t: u.at, kind: 'pop', weight: 0.4, pan: host.pan(u) });
    }
    // nothing in the first 0.6 s: the music's short-term loudness is still near silence there (sfx gate)
    return out.filter((c) => c.t >= 0.6 || c.kind === 'stinger');
  },
});
