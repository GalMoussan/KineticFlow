/**
 * Fluid fill layout (see meta). Setup solves the stack once per landing step (units 0…k): `breakLines` picks the
 * line breaks whose width-filling lines fill the safe height best; the hold shows the last step. Each unit's
 * weight comes from its line at the hold (short lines heavy), and every step is typeset with those weights, so a
 * unit only moves and scales between steps (`flipAt` / `applyPlace`, origin at its ink's top-left).
 */
import { clamp01, visualOrder } from '@reel/runtime';
import { defineLayout, type Host, type Metrics, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { applyPlace, exitSpan, flipAt, fontWeight, inkW, reflowSwipes, setText, WORD_GAP, type Placed } from '../../../lib/modules.ts';
import { meta } from './meta.ts';

const BADGE = { logoH: 1, pad: 0.18, gap: 0.3, radius: 0.22 };
/** The re-flow starts this long before the landing that causes it. */
const LEAD = 0.16;

interface Item {
  u: Unit;
  m: Metrics;
  logo: boolean;
}

/** Line ends (indices), each line's width-filling font size, and the uniform factor that fits the stack. */
interface Lines {
  breaks: number[];
  S: number[];
  f: number;
}

/**
 * Line breaks of `items` whose width-filling stack fills `FH` best (an overflowing stack shrinks to fit). The logo
 * badge, a line of its own, is capped at a fifth of the height and centred instead of filling the width.
 */
function breakLines(items: readonly Item[], FW: number, FH: number, lead: number, per: number): Lines {
  const n = items.length;
  const line = (a: number, b: number) => {
    const ms = items.slice(a, b).map((it) => it.m);
    const w = ms.reduce((q, m) => q + inkW(m), 0) + WORD_GAP * (b - a - 1);
    const S = items[a]!.logo ? Math.min(FW / w, (0.2 * FH) / ms[0]!.ia) : FW / w;
    return { S, h: S * (Math.max(...ms.map((m) => m.ia)) + Math.max(...ms.map((m) => m.id))) };
  };
  // a stack taller than FH is shrunk to fit (its lines then stop short of the width): it counts as FH²/h
  type Cand = { breaks: number[]; S: number[]; h: number; eff: number };
  // the best candidate in a box: TypeScript does not see closure writes to a `let`
  const pick: { best: Cand | null } = { best: null };
  const rec = (a: number, acc: number[]): void => {
    if (a === n) {
      const ls = acc.map((b, i) => line(i ? acc[i - 1]! : 0, b));
      const h = ls.reduce((q, l, i) => q + l.h + (i ? lead * Math.min(l.S, ls[i - 1]!.S) : 0), 0);
      const eff = h <= FH ? h : (FH * FH) / h;
      if (!pick.best || eff > pick.best.eff + 1e-6) pick.best = { breaks: acc, S: ls.map((l) => l.S), h, eff };
      return;
    }
    // a logo badge is a line of its own
    for (let b = a + 1; b <= Math.min(n, a + per); b++) {
      if (b - a > 1 && items.slice(a, b).some((it) => it.logo)) break;
      rec(b, [...acc, b]);
    }
  };
  rec(0, []);
  const best = pick.best!;
  return { breaks: best.breaks, S: best.S, f: Math.min(1, FH / best.h) };
}

/** Places a step's lines centred in the zone: each item's ink top-left and size (box = its line's box). */
function place(items: readonly Item[], sol: Lines, Z: { x: number; y: number; w: number; h: number }, lead: number, dir: 'rtl' | 'ltr'): Placed[] {
  const out: Placed[] = [];
  const lines = sol.breaks.map((b, i) => ({ a: i ? sol.breaks[i - 1]! : 0, b, S: sol.S[i]! * sol.f }));
  const ext = lines.map((l) => {
    const ms = items.slice(l.a, l.b).map((it) => it.m);
    return { ia: Math.max(...ms.map((m) => m.ia)), id: Math.max(...ms.map((m) => m.id)) };
  });
  const H = lines.reduce((q, l, i) => q + l.S * (ext[i]!.ia + ext[i]!.id) + (i ? lead * Math.min(l.S, lines[i - 1]!.S) : 0), 0);
  let y = Z.y + (Z.h - H) / 2;
  lines.forEach((l, i) => {
    if (i) y += lead * Math.min(l.S, lines[i - 1]!.S);
    const its = items.slice(l.a, l.b);
    const lw = (its.reduce((q, it) => q + inkW(it.m), 0) + WORD_GAP * (its.length - 1)) * l.S;
    let x = Z.x + (Z.w - lw) / 2;
    const base = y + ext[i]!.ia * l.S;
    const box = { x, y, w: lw, h: (ext[i]!.ia + ext[i]!.id) * l.S };
    for (const o of visualOrder(its.map((it) => it.u.text || (dir === 'rtl' ? '\u200F' : '\u200E')), dir)) {
      const it = its[o]!;
      out[l.a + o] = { box, S: l.S, x, y: base - it.m.ia * l.S };
      x += (inkW(it.m) + WORD_GAP) * l.S;
    }
    y += box.h;
  });
  return out;
}

/** Weight of a line from its length: 900 for a short word down to 300 for a long line (× `contrast`). */
function lineWeight(host: Host, graphemes: number, contrast: number): number {
  const k = clamp01((graphemes - 3) / 12) * contrast;
  return fontWeight(host, Math.round((900 - 600 * k) / 100) * 100);
}

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((q, l) => q + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    const LOGO: Metrics = { bl: 0, br: badge1.w, ia: badge1.h, id: 0, fa: 0, fd: 0 };
    for (const s of layer.sections) {
      const content = s.units.filter((u) => u.item >= 0);
      if (s.role === 'title' && content.length) content.at(-1)!.tags.hero = true;
      const hi = host.zoomRange(s)[1] * 1.005;
      const m = 0.03 * Math.min(safe.w, safe.h);
      const Z = { x: safe.cx - safe.w / hi / 2 + m, y: safe.cy - safe.h / hi / 2 + m, w: safe.w / hi - 2 * m, h: safe.h / hi - 2 * m };
      const per = Math.round(params.perLine);
      const n = content.length;

      // weights from the hold's lines (solved at a middle weight first)
      const at = (wt: (u: Unit) => number): Item[] =>
        content.map((u) => ({ u, logo: u.kind === 'logos', m: u.kind === 'logos' ? LOGO : host.metrics(u.text, wt(u), u.ltr) }));
      const mid = fontWeight(host, 600);
      const first = breakLines(at(() => mid), Z.w, Z.h, params.lead, per);
      const wts = new Map<Unit, number>();
      first.breaks.forEach((b, i) => {
        const us = content.slice(i ? first.breaks[i - 1]! : 0, b);
        const g = us.reduce((q, u) => q + u.graphemes, 0) + us.length - 1;
        for (const u of us) wts.set(u, u.emphasis || u.tags.hero || u.tags.numeric ? fontWeight(host, 900) : lineWeight(host, g, params.weights));
      });
      const items = at((u) => wts.get(u)!);

      const steps: Placed[][] = [];
      let last: Lines | null = null;
      for (let k = 1; k <= n; k++) {
        const run = items.slice(0, k);
        last = breakLines(run, Z.w, Z.h, params.lead, per);
        steps.push(place(run, last, Z, params.lead, s.dir));
      }
      const fin = steps[n - 1] ?? [];
      items.forEach(({ u, m: mt, logo }, i) => {
        const p = fin[i]!;
        u.origin = '0 0';
        if (!logo) return setText(u, mt, p.S, wts.get(u)!, p.x, p.y);
        const b = logoBadge(host, s, logos, badge1.w * p.S + 1, {
          logoH: BADGE.logoH * p.S,
          pad: BADGE.pad * p.S,
          gap: BADGE.gap * p.S,
          radius: BADGE.radius * p.S,
          fill: '#FFFFFF',
          border: '#FFFFFF',
          shadow: null,
        });
        Object.assign(u, {
          box: { x: p.x, y: p.y, w: b.w, h: b.h },
          textAt: { x: 0, y: 0 },
          innerStyle: { width: `${b.w.toFixed(2)}px`, height: `${b.h.toFixed(2)}px` },
          mount: b.mount,
          mountKey: b.key,
          font: { family: 'display', size: p.S, weight: 400 },
        });
      });
      let a = 0;
      last?.breaks.forEach((b, li) => {
        for (let i = a; i < b; i++) content[i]!.tags.line = li;
        a = b;
      });
      s.data.layout = { steps, top: Z.y, cx: safe.cx };
      s.bounds = { x0: safe.left, y0: safe.top, x1: safe.left + safe.w, y1: safe.top + safe.h };
    }
  },

  frame({ layer, params }, t) {
    for (const s of layer.sections) frameSection(s, t, params.move);
  },
  /** A soft swipe under every re-flow. */
  sounds: ({ layer, params }) => reflowSwipes(layer, LEAD, params.move),
});

function frameSection(s: Section, t: number, dur: number): void {
  const d = s.data.layout as { steps: Placed[][]; top: number; cx: number };
  const n = d.steps.length;
  const m = s.motion;
  const ks = Array.from({ length: n }, (_, j) => (j ? m.inOut(clamp01((t - (s.units[j]!.at - LEAD)) / dur)) : 0));
  // squeezed up and away while the next section grows in
  const x = exitSpan(s, 0.5);
  const q = x && t >= x.t0 ? 1 - m.inOut(clamp01((t - x.t0) / (x.t1 - x.t0))) : 1;
  for (let i = 0; i < n; i++) {
    const u = s.units[i]!;
    const p = flipAt(d.steps, i, ks);
    applyPlace(u, q < 1 ? { box: p.box, S: p.S * q, x: d.cx + (p.x - d.cx) * q, y: d.top + (p.y - d.top) * q } : p, d.steps[n - 1]![i]!);
    if (q < 1) {
      u.ch.opacity *= q;
      u.ch.visible &&= q > 0.01;
    }
  }
}
