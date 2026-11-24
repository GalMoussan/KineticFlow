/**
 * Glyph morph: every text unit lands as the end of an outline morph (`lib/morph`). Plan (setup, in `u.data.reveal`):
 * the previous section's words are paired with this section's words by position (Hungarian on box centres in each
 * section's text bounds, plus a length penalty; only morphable pairs are kept; list items are left to the chain);
 * one unpaired previous word may merge into each paired word (`section.data.reveal.merges`), the others dissolve.
 * Words without a source morph from the latest earlier morphable word (`chain`), else from baseline bars (`line`).
 * Mode (mount): `morph`; `cross` (crossfade of the two outlines) when the source cannot be outlined; `fade` (plain
 * DOM fade) when the unit itself cannot be outlined.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { glyphContours, hungarian, linkHoles, morph, moveContours, rectRing, ringsToD, type Contour, type Morph } from '../../../lib/morph/geom.ts';
import { draw, morphable, overlay, scriptOf, svgEl, unitOutline, xform, type UnitOutline } from '../../../lib/morph/page.ts';
import { mixHex } from '../../../lib/neon.ts';
import { describe, plainEntrance, prevSource, textUnits } from '../../../lib/morph/reveal.ts';
import { endcardStinger, sizeWeight } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

type Src = 'prev' | 'chain' | 'line';
interface Plan {
  /** Morph start / landing (DOM text from then on). */
  s: number;
  e: number;
  src: Src;
  /** `prev`: index into the previous section's units; `chain`: index into this section's units. */
  ref: number;
  mode?: 'morph' | 'cross' | 'fade';
}

interface Item {
  u: Unit;
  plan: Plan;
  m: Morph | null;
  /** Crossfade: the source and target outlines as static paths. */
  dSrc: string;
  dDst: string;
  c0: string;
  c1: string;
  /** Source ink centre (crossfade scaling). */
  sc: [number, number];
  els: { e2: SVGPathElement; e1: SVGPathElement; src: SVGPathElement; main: SVGPathElement };
}
interface Drop {
  d: string;
  color: string;
  cx: number;
  cy: number;
  el: SVGPathElement;
}
const state = new WeakMap<Section, { items: Item[]; drops: Drop[] }>();

/** Gap between consecutive pair starts at the window start (s). */
const STAGGER = 0.05;
/** Shortest morph (s). */
const MIN = 0.3;

const centre = (u: Unit): [number, number] => [u.box.x + u.box.w / 2, u.box.y + u.box.h / 2];

/** Box centres normalised to the units' common bounds (0..1 per axis). */
function normCentres(us: readonly Unit[]): [number, number][] {
  const cs = us.map(centre);
  const xs = cs.map((c) => c[0]);
  const ys = cs.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return cs.map(([x, y]) => [(x - x0) / Math.max(1, x1 - x0), (y - y0) / Math.max(1, y1 - y0)]);
}

/** Baseline bars under each outer contour of the target: one source outer per target outer. */
function bars(o: UnitOutline): Contour[] {
  const S = o.unit.font.size;
  const base = o.bbox[3] - 0.02 * S;
  const rings = o.outline.all
    .filter((c) => c.outer)
    .map((c) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const p of c.ring) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
      }
      return rectRing(x0, base - 0.05 * S, Math.max(2, x1 - x0), 0.05 * S);
    });
  return linkHoles(rings.flatMap((r) => glyphContours([r])));
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.split = 'none';
  },
  setup({ section, params }) {
    const D = params.duration;
    const own = textUnits(section);
    const src = prevSource(section);
    const prevUnits = src ? textUnits(src.prev) : [];
    const candidates = own.filter((u) => !(section.role === 'list' && u.kind === 'list-item'));
    const pairOf = new Map<Unit, Unit>();
    /** Unpaired previous words flow into the nearest paired word: [previous unit index, own unit index]. */
    const merges: [number, number][] = [];
    if (prevUnits.length && candidates.length) {
      const na = normCentres(prevUnits);
      const nb = normCentres(candidates);
      const cost = prevUnits.map((a, i) =>
        candidates.map((b, j) => {
          const dx = na[i]![0] - nb[j]![0];
          const dy = na[i]![1] - nb[j]![1];
          const len = Math.log((a.graphemes + 1) / (b.graphemes + 1));
          return dx * dx + dy * dy + 0.15 * len * len + (scriptOf(a.text) === scriptOf(b.text) ? 0 : 2);
        }),
      );
      // only morphable pairs (same script, similar length) are kept; the rest dissolve (recorded as `drop`)
      const assigned = hungarian(cost.map((row, i) => row.map((c, j) => c + (morphable(prevUnits[i]!, candidates[j]!) ? 0 : 10))));
      assigned.forEach((j, i) => {
        if (j >= 0 && morphable(prevUnits[i]!, candidates[j]!)) pairOf.set(candidates[j]!, prevUnits[i]!);
      });
      const merged = new Set<number>();
      prevUnits.forEach((a, i) => {
        if ([...pairOf.values()].includes(a)) return;
        let best = -1;
        candidates.forEach((b, k) => {
          if (pairOf.has(b) && !merged.has(k) && morphable(a, b) && (best < 0 || cost[i]![k]! < cost[i]![best]!)) best = k;
        });
        if (best < 0) return;
        merged.add(best);
        merges.push([src!.prev.units.indexOf(a), section.units.indexOf(candidates[best]!)]);
      });
    }
    const floor = section.window?.t0 ?? 0;
    const plans = new Map<Unit, Plan>();
    let rank = 0;
    own.forEach((u, i) => {
      const from = pairOf.get(u);
      // chain: the latest earlier word it morphs well from
      const chain = own.slice(0, i).findLast((c) => morphable(c, u));
      let plan: Plan;
      if (from) {
        const s = floor + STAGGER * rank++;
        plan = { s, e: Math.max(s + MIN, Math.min(u.at, s + 1.6 * D)), src: 'prev', ref: from.section.units.indexOf(from) };
      } else if (chain) {
        const s = Math.max(floor, plans.get(chain)!.e, u.at - D);
        plan = { s, e: Math.max(s + MIN, u.at), src: 'chain', ref: section.units.indexOf(chain) };
      } else {
        const s = Math.max(floor, u.at - D);
        plan = { s, e: Math.max(s + MIN, u.at), src: 'line', ref: -1 };
      }
      // never land after the hold starts (QA reads the real text from then on)
      plan.e = Math.min(plan.e, section.timing.holdStart - 0.05);
      plan.s = Math.min(plan.s, plan.e - MIN);
      plans.set(u, plan);
      u.data.reveal = plan;
    });
    section.data.reveal = src ? { prev: src.prev.id, off: src.off, units: prevUnits.map(describe), merges } : null;
  },
  async mount({ host, section }) {
    const src = prevSource(section);
    const svg = overlay(host, section.group, 'glyph-morph');
    const items: Item[] = [];
    const drops: Drop[] = [];
    const used = new Set<Unit>();
    const dropOf = async (from: Unit) => {
      const o = await unitOutline(host, from);
      if (!o || !src) return;
      const d = ringsToD(moveContours(o.outline.all, src.off[0], src.off[1]).map((c) => c.ring));
      drops.push({ d, color: from.color, cx: o.cx + src.off[0], cy: o.cy + src.off[1], el: svgEl('path', svg) });
    };
    for (const u of textUnits(section)) {
      const plan = u.data.reveal as Plan;
      const to = await unitOutline(host, u);
      let from: UnitOutline | null = null;
      let fromContours: Contour[] | null = null;
      let c0 = host.accent(0, section);
      if (plan.src === 'prev' && src) {
        const su = src.prev.units[plan.ref]!;
        used.add(su);
        from = await unitOutline(host, su);
        if (from) fromContours = moveContours(from.outline.all, src.off[0], src.off[1]);
        c0 = su.color;
      } else if (plan.src === 'chain') {
        const cu = section.units[plan.ref]!;
        from = await unitOutline(host, cu);
        if (from) fromContours = from.outline.all;
        c0 = cu.color;
      }
      if (!to) {
        plan.mode = 'fade';
        if (plan.src === 'prev' && src) await dropOf(src.prev.units[plan.ref]!);
        continue;
      }
      const els = { e2: svgEl('path', svg), e1: svgEl('path', svg), src: svgEl('path', svg), main: svgEl('path', svg) };
      const line = plan.src === 'line' || (plan.src === 'chain' && !from);
      if (line) {
        plan.mode = 'morph';
        plan.src = 'line';
        items.push({ u, plan, m: morph(bars(to), to.outline.all), dSrc: '', dDst: '', c0: host.accent(0, section), c1: u.color, sc: [to.cx, to.cy], els });
      } else if (from && fromContours && morphable(from.unit, u)) {
        plan.mode = 'morph';
        items.push({ u, plan, m: morph(fromContours, to.outline.all), dSrc: '', dDst: '', c0, c1: u.color, sc: [0, 0], els });
      } else {
        plan.mode = 'cross';
        const off = plan.src === 'prev' && src ? src.off : [0, 0];
        items.push({
          u,
          plan,
          m: null,
          dSrc: fromContours ? ringsToD(fromContours.map((c) => c.ring)) : '',
          dDst: ringsToD(to.outline.all.map((c) => c.ring)),
          c0,
          c1: u.color,
          sc: from ? [from.cx + off[0]!, from.cy + off[1]!] : [to.cx, to.cy],
          els,
        });
      }
    }
    // unpaired previous words flow into their nearest paired word (several words become one)
    const { merges = [] } = (section.data.reveal ?? {}) as { merges?: [number, number][] };
    for (const [pi, ui] of merges) {
      const su = src!.prev.units[pi]!;
      const u = section.units[ui]!;
      const [from, to] = [await unitOutline(host, su), await unitOutline(host, u)];
      const plan = u.data.reveal as Plan;
      if (!from || !to || plan.mode !== 'morph') continue;
      used.add(su);
      const els = { e2: svgEl('path', svg), e1: svgEl('path', svg), src: svgEl('path', svg), main: svgEl('path', svg) };
      const m = morph(moveContours(from.outline.all, src!.off[0], src!.off[1]), to.outline.all);
      items.unshift({ u, plan, m, dSrc: '', dDst: '', c0: su.color, c1: u.color, sc: [0, 0], els });
    }
    if (src) for (const su of textUnits(src.prev)) if (!used.has(su)) await dropOf(su);
    state.set(section, { items, drops });
  },
  frame({ host, section, params }, t) {
    const st = state.get(section)!;
    const m = section.motion;
    const outlined = new Set(st.items.map((it) => it.u));
    for (const u of section.units) {
      if (!u.revealed) continue;
      if (outlined.has(u)) u.ch.visible &&= t >= (u.data.reveal as Plan).e;
      else plainEntrance(section, u, t);
    }
    const echo = [host.accent(1, section), host.accent(2, section)];
    for (const it of st.items) {
      const { s, e, src } = it.plan;
      const { main, e1, e2, src: srcEl } = it.els;
      if (t >= e || (t < s && src !== 'prev')) {
        for (const el of [main, e1, e2, srcEl]) draw(el, '', '', 0);
        continue;
      }
      const k = clamp01((t - s) / (e - s));
      const q = m.inOut(k);
      if (it.m) {
        draw(srcEl, '', '', 0);
        // the bars draw in over the first 20 %
        draw(main, it.m.path(q), mixHex(it.c0, it.c1, q), src === 'line' ? clamp01(k * 5) : 1);
        // echoes trail behind in accents, strongest mid-morph, gone at both ends
        const env = params.echo * clamp01(6 * k * (1 - k));
        draw(e1, env > 0 ? it.m.path(m.inOut(clamp01(k - 0.08))) : '', echo[0]!, 0.5 * env);
        draw(e2, env > 0 ? it.m.path(m.inOut(clamp01(k - 0.16))) : '', echo[1]!, 0.28 * env);
      } else {
        draw(e1, '', '', 0);
        draw(e2, '', '', 0);
        const [cx, cy] = it.sc;
        draw(srcEl, it.dSrc, it.c0, 1 - q, xform(0, 0, 0, 1 - 0.3 * q, cx, cy));
        draw(main, it.dDst, it.c1, q, xform(0, 0, 0, 0.85 + 0.15 * q, it.u.box.x + it.u.box.w / 2, it.u.box.y + it.u.box.h / 2));
      }
    }
    const t0 = section.window?.t0 ?? 0;
    for (const d of st.drops) {
      // the crossfade fallback: unpaired (or unmorphable) words shrink upwards and fade while the new words form
      const k = clamp01((t - t0) / 0.35);
      const q = m.exit(k);
      draw(d.el, k < 1 ? d.d : '', d.color, (1 - k) * (1 - k), xform(0, -0.04 * host.H * q, 0, 1 - 0.4 * q, d.cx, d.cy));
    }
  },
  /** A whoosh over the morph from the previous section, a shimmer as each word settles (pitch rising), the stinger. */
  sounds({ host, section }) {
    const out: SoundCue[] = endcardStinger(section);
    const own = textUnits(section);
    let si = 0;
    own.forEach((u, i) => {
      const p = u.data.reveal as Plan;
      if (u.kind === 'sub') {
        const c = subLanding(p.e, si++, host.pan(u, p.e));
        if (c) out.push(c);
        return;
      }
      const w = u.tags.hero ? 0.6 : 0.25 + 0.3 * sizeWeight(u, host.H, 0.1);
      out.push({ t: p.e, kind: 'shimmer', weight: w, pitch: Math.min(6, i), pan: host.pan(u, p.e) });
    });
    const firstPrev = own.map((u) => u.data.reveal as Plan).filter((p) => p.src === 'prev');
    if (section.window && firstPrev.length) {
      const until = Math.max(...firstPrev.map((p) => p.e));
      out.push({ t: section.window.t0, until, kind: 'whoosh', weight: 0.45 });
    }
    for (const u of section.units) {
      if (!(u.revealed && !own.includes(u) && Number.isFinite(u.at))) continue;
      if (u.kind === 'sub') {
        const c = subLanding(u.at, si++, host.pan(u));
        if (c) out.push(c);
      } else out.push({ t: u.at, kind: 'pop', weight: 0.4, pan: host.pan(u) });
    }
    return out;
  },
});
