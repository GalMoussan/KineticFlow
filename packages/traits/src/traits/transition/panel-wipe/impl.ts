import { clamp01 } from '@reel/runtime';
import { defineTransition, type Section } from '../../../contract.ts';
import { bases, surface } from '../../../lib/bauhaus.ts';
import { meta } from './meta.ts';

type Geom = 'up' | 'down' | 'rtl' | 'ltr' | 'doors' | 'iris' | 'diag';
const BY_PARAM: Geom[] = ['up', 'down', 'rtl', 'ltr', 'doors', 'iris', 'diag'];
const AUTO: Geom[] = ['up', 'rtl', 'down', 'diag', 'ltr', 'iris'];
const MIRROR: Partial<Record<Geom, Geom>> = { rtl: 'ltr', ltr: 'rtl' };

/** Choices made at setup, kept in `section.data.transition` (fingerprinted). */
interface Data {
  geom: Geom;
  /** Accent panel colours, leading first. */
  colors: string[];
  iris: { x: number; y: number };
}

/** Start of each panel inside the window (fraction of it), accents first, the layer last; each lasts DUR. */
const STARTS = [[0], [0, 0.35], [0, 0.17, 0.35]] as const;
const DUR = 0.65;

/** Clip of a panel (or the incoming layer) `p` of the way through its wipe. */
function clipFor(geom: Geom, p: number, W: number, H: number, iris: Data['iris']): string | null {
  if (p >= 1) return null;
  const q = `${((1 - p) * 100).toFixed(3)}%`;
  switch (geom) {
    case 'up':
      return `inset(${q} 0 0 0)`;
    case 'down':
      return `inset(0 0 ${q} 0)`;
    case 'rtl':
      return `inset(0 0 0 ${q})`;
    case 'ltr':
      return `inset(0 ${q} 0 0)`;
    case 'doors': {
      const h = `${((1 - p) * 50).toFixed(3)}%`;
      return `inset(0 ${h} 0 ${h})`;
    }
    case 'iris': {
      const R = Math.hypot(Math.max(iris.x, W - iris.x), Math.max(iris.y, H - iris.y));
      return `circle(${(p * R).toFixed(1)}px at ${iris.x.toFixed(1)}px ${iris.y.toFixed(1)}px)`;
    }
    case 'diag': {
      // half-plane (W − x) + (H − y)·S ≤ L sweeping from the bottom-right corner to the top-left one
      const S = 0.55;
      const L = p * (W + H * S);
      const f = ([x, y]: [number, number]) => W - x + (H - y) * S - L;
      const rect: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
      const out: [number, number][] = [];
      rect.forEach((a, i) => {
        const b = rect[(i + 1) % 4]!;
        const fa = f(a);
        const fb = f(b);
        if (fa <= 0) out.push(a);
        if (fa <= 0 !== fb <= 0) {
          const k = fa / (fa - fb);
          out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
        }
      });
      if (out.length < 3) return 'polygon(0 0, 0 0, 0 0)';
      return `polygon(${out.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
    }
  }
}

/** Accent panels per incoming section (in the stage, just below its layer). */
const panels = new Map<Section, HTMLElement[]>();

const progress = (s: Section, t: number, j: number, n: number, inOut: (k: number) => number): number => {
  const w = s.window!;
  const D = w.t1 - w.t0;
  return inOut(clamp01((t - w.t0 - D * STARTS[n]![j]!) / (D * DUR)));
};

export default defineTransition({
  meta,
  setup({ host, section, params }) {
    if (!section.window || !section.prev || section.layer.sections[0] !== section) return;
    const g = Math.round(params.geom);
    let geom: Geom = g > 0 ? BY_PARAM[g - 1]! : section.role === 'endcard' && !section.next ? 'doors' : AUTO[(section.index - 1) % AUTO.length]!;
    if (g === 0 && host.dir === 'ltr') geom = MIRROR[geom] ?? geom;
    const exclude = [surface(host, section.layer).panel, surface(host, section.prev.layer).panel];
    const { dark, light } = bases(section.palette);
    const pool = [2, 1, 0, 3, 4].map((i) => host.accent(i, section)).concat(light, dark);
    const cands = pool.filter((c, i) => !exclude.includes(c) && pool.indexOf(c) === i);
    const n = Math.min(Math.round(params.panels), cands.length);
    const colors = Array.from({ length: n }, (_, j) => cands[(section.index + j) % cands.length]!);
    const data: Data = { geom, colors, iris: { x: host.safe.cx, y: host.safe.top + host.safe.h * 0.25 } };
    section.data.transition = data;
  },
  mount({ host, section }) {
    const d = section.data.transition as Data | undefined;
    if (!d) return;
    panels.set(
      section,
      d.colors.map((c) => {
        const e = host.el('div', 'wipe-panel', null, { background: c });
        host.stage.insertBefore(e, section.layer.el);
        return e;
      }),
    );
  },
  /** Every panel of the reel is rewritten for t (shown only inside its own window). */
  frame({ host }, t) {
    for (const [s, els] of panels) {
      const d = s.data.transition as Data;
      const w = s.window!;
      const n = els.length;
      const inside = t >= w.t0 && t < w.t1;
      const main = progress(s, t, n, n, s.motion.inOut);
      els.forEach((e, j) => {
        const p = progress(s, t, j, n, s.motion.inOut);
        const on = inside && p > 0 && main < 1;
        e.style.display = on ? 'block' : 'none';
        e.style.clipPath = on ? (clipFor(d.geom, p, host.W, host.H, d.iris) ?? 'none') : 'none';
      });
    }
  },
  between({ host, section, params }, w, t) {
    const d = section.data.transition as Data | undefined;
    if (!d) return;
    const n = d.colors.length;
    const p = progress(section, t, n, n, section.motion.inOut);
    w.incoming.ch.clip = clipFor(d.geom, p, host.W, host.H, d.iris);
    if (d.geom === 'doors') return;
    const o = w.outgoing.ch;
    const P = params.push * host.W * p;
    switch (d.geom) {
      case 'up':
        o.ty -= P;
        break;
      case 'down':
        o.ty += P;
        break;
      case 'rtl':
        o.tx -= P;
        break;
      case 'ltr':
        o.tx += P;
        break;
      case 'diag':
        o.tx -= P * 0.7;
        o.ty -= P;
        break;
      case 'iris':
        o.s *= 1 + p * 0.18;
        break;
    }
    o.blur += Math.sin(Math.PI * p) * params.blur;
  },
});
