/**
 * Versus split (see meta). Setup splits each section into sides A (reading start) and B, builds two panel
 * decorations (full-frame boxes clipped to their half by a tilted seam), a badge decoration on the seam and
 * typesets each side centred in its half of the safe area, clear of the seam and the badge. Frames slam the panels
 * in (A from the start side, B from the other: along the seam), pop the badge once both landed, and throw the
 * panels out the far side while the content exits before the next layer.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineLayout, type Section, type Unit } from '../../../contract.ts';
import { logoBadge } from '../../../lib/deco.ts';
import { contrastOf, fitLines, fontWeight, inkH, inkW, placeLines, setText, type Box } from '../../../lib/modules.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const CONNECTORS: Partial<Record<string, true>> = { or: true, vs: true, 'vs.': true, versus: true, או: true, נגד: true, מול: true };
const BADGE = { logoH: 1, pad: 0.18, gap: 0.3, radius: 0.2 };
/** Panels overhang the frame by this much (camera shake and kicks never show an edge). */
const BLEED = 80;
/** A panel lands this long before the first landing of its side. */
const EARLY = 0.12;
/** Exit time of a section that never exits (JSON-safe, unlike Infinity). */
const NEVER = 1e6;

/** `unit.data.layout` of a panel / the badge (fingerprinted). */
interface Panel {
  role: 'panel';
  /** Slam: from (dx, dy) × the travel to rest, [t0, t1]; exits the opposite way during [x0, x1]. */
  dx: number;
  dy: number;
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}
interface Badge {
  role: 'badge';
  t0: number;
  x0: number;
  x1: number;
}

/** Content of the two sides (B empty = one full-frame panel) and the connector word for the badge. */
function sidesOf(s: Section): { a: Unit[]; b: Unit[]; vs: Unit | null } {
  const content = s.units.filter((u) => u.item >= 0);
  const of = (...kinds: string[]) => content.filter((u) => kinds.includes(u.kind));
  const ci = content.findIndex((u, i) => i > 0 && i < content.length - 1 && u.kind === 'word' && CONNECTORS[u.text.toLowerCase().replace(/[!?.,:]+$/u, '')]);
  if (ci > 0) return { a: content.slice(0, ci), b: content.slice(ci + 1), vs: content[ci]! };
  const two = (a: Unit[], b: Unit[]) => (a.length && b.length ? { a, b, vs: null } : { a: [...a, ...b], b: [], vs: null });
  switch (s.role) {
    case 'datetime':
      return of('time').length ? two(of('weekday', 'date'), of('time')) : two(of('weekday'), of('date'));
    case 'location':
      return two(of('place'), of('city'));
    case 'list':
      return two(of('list-title'), of('list-item'));
    case 'stat':
    case 'countdown':
      return two(of('stat', 'countdown'), of('word'));
    case 'endcard':
      return two(of('word'), of('logos'));
    default: {
      if (content.length < 2) return { a: content, b: [], vs: null };
      // the split point that balances the two sides' graphemes (first on ties)
      const total = content.reduce((q, u) => q + u.graphemes, 0);
      let best = 1;
      let acc = 0;
      let bestD = Infinity;
      for (let k = 1; k < content.length; k++) {
        acc += content[k - 1]!.graphemes;
        const d = Math.abs(total - 2 * acc);
        if (d < bestD) [best, bestD] = [k, d];
      }
      return { a: content.slice(0, best), b: content.slice(best), vs: null };
    }
  }
}

const poly = (pts: [number, number][]) => `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { W, H, safe } = host;
    const logos = host.reel.logos;
    const badge1 = {
      w: logos.reduce((q, l) => q + (BADGE.logoH * l.w) / l.h, 0) + BADGE.gap * Math.max(0, logos.length - 1) + 2 * BADGE.pad,
      h: BADGE.logoH + 2 * BADGE.pad,
    };
    const wide = safe.w > 1.3 * safe.h;
    for (const s of layer.sections) {
      const content = s.units.filter((u) => u.item >= 0);
      if (s.role === 'title' && content.length) content.at(-1)!.tags.hero = true;
      const { a, b, vs } = sidesOf(s);
      const split = b.length > 0;
      const hi = host.zoomRange(s)[1] * 1.005;
      // the safe area as the largest hold zoom leaves it, around the focus point
      const Z = { x: safe.cx - safe.w / hi / 2, y: safe.cy - safe.h / hi / 2, w: safe.w / hi, h: safe.h / hi };
      const m = 0.045 * Math.min(Z.w, Z.h);
      const R = (params.badge * Math.min(safe.w, safe.h)) / hi;
      const rtl = s.dir === 'rtl';
      const startLeft = !rtl;
      const p = s.palette;
      const fillA = host.accent(s.index % 2, s);
      const fillB = host.accent((s.index + 1) % 2, s);
      const badgeFill = host.accent(2, s);

      // ── panels: full-frame boxes clipped to their side of a tilted seam (panel coordinates = box + BLEED) ──
      const B0 = { x: -BLEED, y: -BLEED, w: W + 2 * BLEED, h: H + 2 * BLEED };
      const P = (x: number, y: number): [number, number] => [x + BLEED, y + BLEED];
      const gap = 0.006 * Math.min(W, H);
      let clipA: string;
      let clipB: string | null = null;
      let tilt = 0;
      if (!split) clipA = 'none';
      else if (wide) {
        tilt = params.tilt * (H / 2);
        const cx = safe.cx;
        const left = [P(-BLEED, -BLEED), P(cx + tilt - gap, -BLEED), P(cx - tilt - gap, H + BLEED), P(-BLEED, H + BLEED)];
        const right = [P(cx + tilt + gap, -BLEED), P(W + BLEED, -BLEED), P(W + BLEED, H + BLEED), P(cx - tilt + gap, H + BLEED)];
        clipA = poly(startLeft ? left : right);
        clipB = poly(startLeft ? right : left);
      } else {
        tilt = params.tilt * (W / 2);
        const cy = safe.cy;
        // the seam rises towards the reading end
        const [yl, yr] = rtl ? [cy - tilt, cy + tilt] : [cy + tilt, cy - tilt];
        clipA = poly([P(-BLEED, -BLEED), P(W + BLEED, -BLEED), P(W + BLEED, yr - gap), P(-BLEED, yl - gap)]);
        clipB = poly([P(-BLEED, yl + gap), P(W + BLEED, yr + gap), P(W + BLEED, H + BLEED), P(-BLEED, H + BLEED)]);
      }

      // ── slam timing: each side lands just before its first landing ──
      const firstOf = (us: Unit[]) => Math.min(...us.map((u) => u.at).filter(Number.isFinite), s.timing.lastLand);
      const from = s.window?.t0 ?? 0;
      const ex = exitWindow(s);
      const landA = Math.max(from + params.slam, firstOf(a) - EARLY);
      const landB = Math.max(landA + 0.1, firstOf(b.length ? b : a) - EARLY);
      const side = startLeft ? -1 : 1;
      const mk = (clip: string, fill: string, land: number, dir: number): Unit => {
        const data: Panel = {
          role: 'panel',
          dx: wide ? 0 : dir,
          dy: wide ? dir : 0,
          t0: Math.max(from, land - params.slam),
          t1: land,
          x0: ex?.t0 ?? NEVER,
          x1: ex?.t1 ?? NEVER + 1,
        };
        // the clip lives on an inner element: the host owns the unit's own clip-path (the `clip` channel)
        const u = host.deco(s, {
          deco: 'panel',
          box: { ...B0 },
          z: -5,
          textAt: { x: 0, y: 0 },
          innerStyle: { width: `${B0.w}px`, height: `${B0.h}px` },
          html: `<div style="position:absolute;inset:0;background:${fill};clip-path:${clip}"></div>`,
        });
        u.data.layout = data;
        u.hit = { t: land, amp: 0.012 * Math.min(W, H) };
        return u;
      };
      // wide: A drops from the top, B rises from the bottom; stacked: A from the start side, B from the end side
      mk(clipA, fillA, landA, wide ? -1 : side);
      if (clipB) mk(clipB, fillB, landB, wide ? 1 : -side);

      // ── text zones ──
      const clear = Math.max(R, tilt) + m;
      let zA: Box;
      let zB: Box | null = null;
      if (!split) zA = { x: Z.x + m, y: Z.y + m, w: Z.w - 2 * m, h: Z.h - 2 * m };
      else if (wide) {
        const left = { x: Z.x, y: Z.y + m, w: safe.cx - clear - Z.x, h: Z.h - 2 * m };
        const right = { x: safe.cx + clear, y: Z.y + m, w: Z.x + Z.w - safe.cx - clear, h: Z.h - 2 * m };
        [zA, zB] = startLeft ? [left, right] : [right, left];
      } else {
        zA = { x: Z.x, y: Z.y, w: Z.w, h: safe.cy - clear - Z.y };
        zB = { x: Z.x, y: safe.cy + clear, w: Z.w, h: Z.y + Z.h - safe.cy - clear };
      }
      const CAP = 0.36 * Math.min(Z.w, Z.h);
      const typeset = (us: Unit[], z: Box, fill: string) => {
        const text = us.filter((u) => u.kind !== 'logos');
        const logo = us.find((u) => u.kind === 'logos');
        if (logo) {
          const S = Math.min(z.w / badge1.w, z.h / badge1.h, CAP);
          const bd = logoBadge(host, s, logos, badge1.w * S + 1, {
            logoH: BADGE.logoH * S,
            pad: BADGE.pad * S,
            gap: BADGE.gap * S,
            radius: BADGE.radius * S,
            fill: '#FFFFFF',
            border: '#FFFFFF',
            shadow: null,
          });
          Object.assign(logo, {
            box: { x: z.x + (z.w - bd.w) / 2, y: z.y + (z.h - bd.h) / 2, w: bd.w, h: bd.h },
            textAt: { x: 0, y: 0 },
            innerStyle: { width: `${bd.w.toFixed(2)}px`, height: `${bd.h.toFixed(2)}px` },
            mount: bd.mount,
            mountKey: bd.key,
            font: { family: 'display', size: S, weight: 900 },
          });
        }
        if (!text.length) return;
        const wts = text.map((u) => fontWeight(host, u.emphasis || u.tags.hero || u.tags.numeric ? 900 : u.kind === 'weekday' || u.kind === 'city' || u.kind === 'list-title' ? 600 : 800));
        const ms = text.map((u, i) => host.metrics(u.text, wts[i]!, u.ltr));
        const f = fitLines(ms, z.w, z.h, s.role === 'list' ? 5 : 4);
        placeLines(text, ms, wts, { ...f, S: Math.min(f.S, CAP) }, z, 'center', 'middle', s.dir);
        const pop = host.accent(2, s);
        for (const u of text) {
          const strong = u.emphasis || u.tags.hero;
          u.data.layout = { ink: strong && contrastOf(pop, fill) >= 2.5 ? pop : contrastOf(p.text, fill) >= contrastOf(p.bg, fill) ? p.text : p.bg };
        }
      };
      typeset(a, zA, fillA);
      if (zB) typeset(b, zB, fillB);

      // ── badge on the seam (the connector word on it, else a bolt) ──
      if (split) {
        const bdata: Badge = { role: 'badge', t0: landB + 0.05, x0: ex?.t0 ?? NEVER, x1: ex?.t1 ?? NEVER + 1 };
        const ring = 0.12 * R;
        const bolt = vs ? '' : `<path d="M58 8 L24 56 H48 L40 92 L76 40 H52 Z" fill="${p.bg}"/>`;
        const disc = host.deco(s, {
          deco: 'badge',
          box: { x: safe.cx - R, y: safe.cy - R, w: 2 * R, h: 2 * R },
          z: 2,
          html:
            `<svg width="${(2 * R).toFixed(1)}" height="${(2 * R).toFixed(1)}" viewBox="0 0 100 100" style="display:block;overflow:visible">` +
            `<circle cx="50" cy="50" r="${(50 - (ring / R) * 25).toFixed(2)}" fill="${badgeFill}" stroke="${p.bg}" stroke-width="${((ring / R) * 50).toFixed(2)}"/>${bolt}</svg>`,
          textAt: { x: 0, y: 0 },
        });
        disc.data.layout = bdata;
        if (vs) {
          const wt = fontWeight(host, 900);
          const mm = host.metrics(vs.text, wt, vs.ltr);
          const S = Math.min((1.25 * R) / inkW(mm), (0.8 * R) / inkH(mm));
          setText(vs, mm, S, wt, safe.cx - (inkW(mm) * S) / 2, safe.cy - (inkH(mm) * S) / 2);
          vs.z = 3;
          vs.data.layout = { ink: contrastOf(p.bg, badgeFill) >= contrastOf(p.text, badgeFill) ? p.bg : p.text };
        }
      } else if (vs) typeset([vs], zA, fillA);
      s.place = { x: 0, y: 0, rot: 0 };
      s.bounds = { x0: 0, y0: 0, x1: W, y1: H };
      s.data.layout = { wide, split, landA, landB };
    }
  },

  frame({ host, layer, params }, t) {
    for (const s of layer.sections) {
      const m = s.motion;
      for (const u of s.units) {
        const d = u.data.layout as Panel | Badge | undefined;
        if (!d || u.item >= 0) continue;
        const c = u.ch;
        if (d.role === 'panel') {
          c.visible &&= t >= d.t0;
          const k = clamp01((t - d.t0) / (d.t1 - d.t0));
          const e = 1 - m.bounce(k, 1.1);
          const xk = m.exit(clamp01((t - d.x0) / (d.x1 - d.x0)));
          // in from (dx, dy), out the opposite way
          c.tx += (d.dx * e - d.dx * xk) * (host.W + 2 * BLEED);
          c.ty += (d.dy * e - d.dy * xk) * (host.H + 2 * BLEED);
          if (k < 1) c.blur += (1 - k) * 10;
          c.visible &&= xk < 1;
        } else {
          const k = clamp01((t - d.t0) / (params.slam * 1.2));
          const xk = clamp01((t - d.x0) / Math.min(0.2, d.x1 - d.x0));
          const sc = Math.max(0, m.bounce(k, 2.2)) * (1 - m.exit(xk));
          c.visible &&= t >= d.t0 && sc > 0.001;
          c.sx *= sc;
          c.sy *= sc;
          c.rot += (1 - m.enter(k)) * -120;
        }
      }
    }
  },

  /** A whoosh into each panel's slam and a thump when it lands (panned to its side); a pop as the badge lands. */
  sounds({ host, layer }) {
    const out: SoundCue[] = [];
    for (const s of layer.sections) {
      for (const u of s.units) {
        const d = u.data.layout as Panel | Badge | undefined;
        if (!d || u.item >= 0) continue;
        if (d.role === 'panel') {
          const pan = d.dx ? -0.4 * d.dx : 0;
          out.push({ t: d.t0, until: d.t1, kind: 'whoosh', weight: 0.4, pan, section: s.id });
          out.push({ t: d.t1, kind: 'impact', weight: 0.5, pan, section: s.id });
        } else out.push({ t: d.t0 + 0.12, kind: 'pop', weight: 0.5, pitch: 4, pan: host.pan(u), section: s.id });
      }
    }
    return out;
  },
});
