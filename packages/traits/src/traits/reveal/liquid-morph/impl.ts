/**
 * Liquid morph. Per text unit (plan in `u.data.reveal`): rise → split → morph, then the real DOM text.
 *  - rise: one wobbling drop (area = the word's droplets together) comes up from below the frame on a curve,
 *    stretched by its speed, a smaller droplet trailing on a metaball neck;
 *  - split: the drop shrinks while one droplet per grapheme (harfbuzz cluster, niqqud included) slides out to its
 *    letter, neighbours joined by necks that thin and snap;
 *  - morph: each droplet becomes its letter outline (`lib/morph`), accent → text colour.
 * The previous section's letters (its layer is cut away at the window start) melt back into droplets that drip out
 * of the frame. Units without an outline fade in.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, lerp } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { circleRing, glyphContours, morph, moveContours, ringsBBox, type Contour, type Morph, type Pt } from '../../../lib/morph/geom.ts';
import { blob, neck } from '../../../lib/morph/goo.ts';
import { draw, overlay, svgEl, unitOutline } from '../../../lib/morph/page.ts';
import { describe, fit, plainEntrance, prevSource, textUnits } from '../../../lib/morph/reveal.ts';
import { mixHex } from '../../../lib/neon.ts';
import { endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

/** Exit: letters → droplets, then the drip (s). */
const MELT = 0.24;
const DRIP = 0.55;

interface Plan {
  start: number;
  e: number;
  f: number;
  /** Rising from the left (-1) or right (1) of the word. */
  side: number;
}
interface Drop {
  /** Letter centre and droplet radius. */
  c: Pt;
  r: number;
  m: Morph;
}
interface Paths {
  goo: SVGPathElement;
  neck: SVGPathElement;
  glyphs: SVGPathElement;
}
interface Entry {
  u: Unit;
  plan: Plan;
  /** Word centre, drop radius, accent. */
  w: Pt;
  R: number;
  color: string;
  drops: Drop[];
  els: Paths;
}
interface Melt {
  from: string;
  to: string;
  drops: Drop[];
  els: Paths;
}
const state = new WeakMap<Section, { entries: Entry[]; melts: Melt[] }>();

/** A droplet per grapheme: area-equivalent circle at the grapheme's ink centre (never smaller than a dot). */
function droplets(clusters: readonly Contour[][], S: number, toLetter: boolean): Drop[] {
  return clusters.map((cl) => {
    const [x0, y0, x1, y1] = ringsBBox(cl.map((c) => c.ring));
    const area = cl.reduce((a, c) => a + (c.outer ? c.area : -c.area), 0);
    const r = Math.max(0.07 * S, Math.min(0.42 * S, 1.05 * Math.sqrt(Math.max(0, area) / Math.PI)));
    const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
    const circle = glyphContours([circleRing(c[0], c[1], r, 48)]);
    return { c, r, m: toLetter ? morph(circle, cl) : morph(cl, circle) };
  });
}

/** Necks between visual neighbours, radii scaled by g (< 1 thins them until they snap). */
function necks(cs: readonly Pt[], rs: readonly number[], g: number): string {
  let d = '';
  for (let j = 0; j + 1 < cs.length; j++) d += neck(cs[j]!, rs[j]! * g, cs[j + 1]!, rs[j + 1]! * g);
  return d;
}

const hide = (p: Paths) => {
  draw(p.goo, '', '', 0);
  draw(p.neck, '', '', 0);
  draw(p.glyphs, '', '', 0);
};

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.split = 'none';
  },
  setup({ section, params }) {
    const L = params.rise + params.split + params.duration;
    const floor = section.window?.t0 ?? 0;
    textUnits(section).forEach((u, i) => {
      const e = Math.min(u.at + 0.05, section.timing.holdStart - 0.05);
      const { start, f } = fit(e, L, floor);
      u.data.reveal = { start, e, f, side: i % 2 ? 1 : -1 } satisfies Plan;
    });
    const src = prevSource(section);
    section.data.reveal = src ? { prev: src.prev.id, off: src.off, units: textUnits(src.prev).map(describe) } : null;
  },
  async mount({ host, section }) {
    const svg = overlay(host, section.group, 'liquid-morph');
    const paths = (): Paths => ({ goo: svgEl('path', svg), neck: svgEl('path', svg), glyphs: svgEl('path', svg) });
    const melts: Melt[] = [];
    const entries: Entry[] = [];
    const src = prevSource(section);
    for (const su of src ? textUnits(src.prev) : []) {
      const o = await unitOutline(host, su);
      if (!o) continue;
      const cl = o.outline.clusters.map((c) => moveContours(c, src!.off[0], src!.off[1]));
      melts.push({ from: su.color, to: host.accent(su.item, src!.prev), drops: droplets(cl, su.font.size, false), els: paths() });
    }
    for (const u of textUnits(section)) {
      const o = await unitOutline(host, u);
      if (!o) continue;
      const drops = droplets(o.outline.clusters, u.font.size, true);
      const R = Math.min(0.85 * u.font.size, Math.sqrt(drops.reduce((a, d) => a + d.r * d.r, 0)));
      entries.push({ u, plan: u.data.reveal as Plan, w: [o.cx, o.cy], R, color: host.accent(u.item, section), drops, els: paths() });
    }
    state.set(section, { entries, melts });
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
    const wob = params.wobble;
    for (const x of st.entries) {
      const { start, e, f, side } = x.plan;
      if (t < start || t >= e) {
        hide(x.els);
        continue;
      }
      const tS = start + f * params.rise;
      const tM = tS + f * params.split;
      const { w, R } = x;
      const ph = t * 7 + x.u.id;
      if (t < tS) {
        // rise on a quadratic curve from below the frame, stretched along the motion
        const k = (t - start) / (tS - start);
        const p0: Pt = [w[0] + side * 0.18 * host.W, host.H + 1.6 * R];
        const pc: Pt = [w[0] - side * 0.12 * host.W, lerp(p0[1], w[1], 0.55)];
        const along = (q: number): Pt => [
          (1 - q) * (1 - q) * p0[0] + 2 * (1 - q) * q * pc[0] + q * q * w[0],
          (1 - q) * (1 - q) * p0[1] + 2 * (1 - q) * q * pc[1] + q * q * w[1],
        ];
        const q = m.enter(k);
        const c = along(q);
        const r = R * lerp(0.7, 1, q);
        const stretch = 0.35 * (1 - q);
        const tail = along(m.enter(clamp01(k - 0.14)));
        const tr = R * 0.42 * (1 - 0.6 * q);
        draw(x.els.goo, blob(c, r, wob, ph, 1 - 0.4 * stretch, 1 + stretch) + blob(tail, tr, wob, ph + 2), x.color, 1);
        draw(x.els.neck, neck(c, r, tail, tr), x.color, 1);
        draw(x.els.glyphs, '', '', 0);
      } else if (t < tM) {
        // the drop shrinks while droplets slide out to their letters, necks thinning until they snap
        const k = (t - tS) / (tM - tS);
        const q = m.enter(k);
        const cs = x.drops.map((d): Pt => [lerp(w[0], d.c[0], q), lerp(w[1], d.c[1], q)]);
        const rs = x.drops.map((d) => d.r * lerp(0.75, 1, q));
        let goo = blob(w, R * (1 - q), wob * (1 - q), ph);
        cs.forEach((c, j) => (goo += blob(c, rs[j]!, wob * 0.6, ph + j)));
        draw(x.els.goo, goo, x.color, 1);
        draw(x.els.neck, necks(cs, rs, lerp(1, 0.55, k)), x.color, 1);
        draw(x.els.glyphs, '', '', 0);
      } else {
        const k = (t - tM) / (e - tM);
        const q = m.inOut(k);
        draw(x.els.goo, '', '', 0);
        draw(x.els.neck, '', '', 0);
        draw(x.els.glyphs, x.drops.map((d) => d.m.path(q)).join(''), mixHex(x.color, x.u.color, q), 1);
      }
    }
    // the previous section's letters melt into droplets and drip away
    const t0 = section.window?.t0 ?? 0;
    for (const x of st.melts) {
      const k1 = clamp01((t - t0) / MELT);
      if (t < t0 || t >= t0 + MELT + DRIP + 0.2) {
        hide(x.els);
        continue;
      }
      if (k1 < 1) {
        const q = m.inOut(k1);
        draw(x.els.glyphs, x.drops.map((d) => d.m.path(q)).join(''), mixHex(x.from, x.to, q), 1);
        draw(x.els.goo, '', '', 0);
        draw(x.els.neck, '', '', 0);
        continue;
      }
      draw(x.els.glyphs, '', '', 0);
      const ph = t * 7;
      const cs: Pt[] = [];
      const rs: number[] = [];
      let goo = '';
      x.drops.forEach((d, j) => {
        // droplets let go one after another; gravity and a stretch along the fall
        const k = clamp01((t - t0 - MELT - 0.035 * j) / DRIP);
        const c: Pt = [d.c[0], d.c[1] + 0.75 * host.H * k * k];
        const r = d.r * (1 - 0.25 * k);
        cs.push(c);
        rs.push(r);
        goo += blob(c, r, 0.05, ph + j, 1 - 0.2 * k, 1 + 0.5 * k);
      });
      draw(x.els.goo, goo, x.to, 1);
      draw(x.els.neck, necks(cs, rs, 0.9), x.to, 1);
    }
  },
  /**
   * Each drop whooshes softly as it rises and pops (pitch rising through the section) when it splits into droplets;
   * the hero shimmers when it becomes text; the previous section's letters drip away with a whoosh.
   */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section);
    const st = state.get(section)!;
    let si = 0;
    st.entries.forEach((x, i) => {
      const { start, e, f } = x.plan;
      const tS = start + f * params.rise;
      const pan = host.pan(x.u, e);
      if (x.u.kind === 'sub') {
        const c = subLanding(e, si++, pan);
        if (c) out.push(c);
        return;
      }
      out.push({ t: start, until: tS, kind: 'whoosh', weight: 0.2, pan });
      out.push({ t: tS, kind: 'pop', weight: 0.25 + 0.3 * sizeWeight(x.u, host.H, 0.1), pitch: Math.min(7, i) - 2, pan });
      if (x.u.tags.hero || x.u.emphasis) out.push({ t: e, kind: 'shimmer', weight: 0.4, pan });
    });
    if (section.window && st.melts.length) out.push({ t: section.window.t0 + MELT, until: section.window.t0 + MELT + DRIP, kind: 'whoosh', weight: 0.35 });
    const outlined = new Set(st.entries.map((x) => x.u));
    for (const u of section.units) {
      if (!(u.revealed && !outlined.has(u) && Number.isFinite(u.at))) continue;
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, host.pan(u));
        if (c) out.push(c);
      } else out.push({ t: u.at, kind: 'pop', weight: 0.4, pan: host.pan(u) });
    }
    return out;
  },
});
