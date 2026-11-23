import { clamp01 } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { circle, cup, half, panelColor, ring, shapeColors, stripes, type ShapeArt } from '../../../lib/bauhaus.ts';
import { meta } from './meta.ts';

type Kind = 'circle' | 'ring' | 'half' | 'stripes' | 'cup' | 'dot';
/** One shape (screen px), kept in `layer.data.background` (fingerprinted). */
interface Shape {
  kind: Kind;
  /** Anchor point (screen px) and where it sits in the box (fractions): the box grows around it. */
  ax: number;
  ay: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** SVG markup (stretches with the box), or a CSS background for stripes. */
  svg: string;
  bg: string;
  /** Pop-in time. */
  at: number;
  /** Scale added on a full beat pulse. */
  amp: number;
  /** Degrees the shape turns while popping in. */
  spin: number;
}
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Slot {
  kind: Kind;
  ax: number;
  ay: number;
  ox: number;
  oy: number;
  art: ShapeArt | { w: number; h: number; bg: string };
}

const els = new WeakMap<Layer, HTMLElement[]>();
const meets = (a: Rect, b: Rect, m: number) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
const rectOf = (s: Slot): Rect => {
  const x0 = s.ax - s.ox * s.art.w;
  const y0 = s.ay - s.oy * s.art.h;
  return { x0, y0, x1: x0 + s.art.w, y1: y0 + s.art.h };
};
const px = (v: number) => `${v.toFixed(2)}px`;

export default defineBackground({
  meta,
  setup({ host, layer, params }) {
    const { W, H } = host;
    const m = Math.min(W, H);
    const panel = panelColor(host, layer);
    host.el('div', 'solid', layer.under, { background: panel });

    // text to keep clear of (layer coordinates = screen coordinates under a static camera)
    const avoid: Rect[] = layer.world ? [] : layer.sections.flatMap((s) => (s.bounds ? [s.bounds] : []));
    const text = avoid[0];
    const col = shapeColors(layer.palette, panel, layer.index);
    const C = (c: number) => col[c % col.length]!;
    const rtl = host.dir === 'rtl';
    /** x measured from the end edge (left in RTL) / from the start edge. */
    const endX = (d: number) => (rtl ? d : W - d);
    const startX = (d: number) => (rtl ? W - d : d);

    // Shape templates at scale f; tried in an order rotated by the layer index, shrunk until clear of the text.
    const slots: ((f: number, c: number) => Slot)[] = [
      (f, c) => ({ kind: 'half', ax: endX(0.22 * W), ay: H, ox: 0.5, oy: 1, art: half(0.26 * m * f, C(c), 'bottom') }),
      (f, c) => {
        const R = 0.22 * m * f;
        return {
          kind: 'cup', ax: endX(0.06 * m + R), ay: H - 0.06 * m - R, ox: 0.5, oy: 0.5,
          art: cup(R, { saucer: C(c + 1), body: C(c), coffee: C(c + 2), handleLeft: !rtl }),
        };
      },
      (f, c) => ({ kind: 'circle', ax: startX(0.02 * m), ay: 0.1 * m, ox: 0.5, oy: 0.5, art: circle(0.2 * m * f, C(c)) }),
      (f, c) => {
        const w = 0.36 * m * f;
        const h = 0.2 * m * f;
        return { kind: 'stripes', ax: startX(0.07 * m), ay: H - 0.08 * m, ox: rtl ? 1 : 0, oy: 1, art: { w, h, bg: stripes(C(c), 0.015 * m, 0.022 * m) } };
      },
      (f, c) => {
        const r = 0.2 * m * f;
        return { kind: 'ring', ax: startX(0), ay: H * 0.82, ox: 0.5, oy: 0.5, art: ring(r, 0.015 * m, C(c)) };
      },
      (f, c) => ({ kind: 'half', ax: endX(0.16 * W), ay: 0, ox: 0.5, oy: 0, art: half(0.19 * m * f, C(c), 'top') }),
      (f, c) => ({
        kind: 'stripes', ax: endX(0.07 * m), ay: 0.1 * m, ox: rtl ? 0 : 1, oy: 0,
        art: { w: 0.3 * m * f, h: 0.035 * m, bg: stripes(C(c), 0.009 * m, 0.015 * m) },
      }),
      (f, c) => {
        const r = 0.032 * m * f;
        return {
          kind: 'dot',
          ax: text ? (rtl ? text.x0 + r : text.x1 - r) : endX(0.15 * W),
          ay: text ? text.y1 + 0.05 * m + r : H - 0.15 * m,
          ox: 0.5, oy: 0.5, art: circle(r, C(c)),
        };
      },
    ];

    const want = Math.round(params.shapes * 5);
    const first = layer.sections[0]!.timing;
    const shapes: Shape[] = [];
    const placed: Rect[] = [];
    const frame: Rect = { x0: 0, y0: 0, x1: W, y1: H };
    for (let i = 0; i < slots.length && shapes.length < want; i++) {
      const slot = slots[(i + layer.index * 3) % slots.length]!;
      for (const f of layer.world ? [0.6] : [1, 0.75, 0.55]) {
        const s = slot(f, shapes.length);
        const r = rectOf(s);
        if (!meets(r, frame, 0)) continue;
        if (avoid.some((a) => meets(a, r, 0.02 * m)) || placed.some((p) => meets(p, r, 0.01 * m))) continue;
        placed.push(r);
        shapes.push({
          kind: s.kind,
          ax: s.ax,
          ay: s.ay,
          ox: s.ox,
          oy: s.oy,
          w: s.art.w,
          h: s.art.h,
          svg: 'svg' in s.art ? s.art.svg : '',
          bg: 'bg' in s.art ? s.art.bg : '',
          at: first.firstLand + 0.1 + shapes.length * 0.15,
          amp: { circle: 0.03, ring: 0.04, cup: 0.03, dot: 0.25, half: 0, stripes: 0 }[s.kind],
          spin: s.kind === 'cup' ? (layer.index % 2 ? 140 : -140) : 0,
        });
        break;
      }
    }
    layer.data.background = { panel, shapes };
    els.set(
      layer,
      shapes.map((s) => {
        const e = host.el('div', 'bh', layer.under, s.bg ? { background: s.bg } : {});
        if (s.svg) e.innerHTML = s.svg;
        return e;
      }),
    );
  },

  frame({ layer, params }, t) {
    const { shapes } = layer.data.background as { shapes: Shape[] };
    const s = layer.sections.find((x) => t >= x.timing.in && t < x.timing.out) ?? layer.sections[0]!;
    const m = s.motion;
    const pulse = s.pulse(t) * params.pulse;
    els.get(layer)!.forEach((e, i) => {
      const q = shapes[i]!;
      const k = clamp01((t - q.at) / 0.45);
      let sx = 1;
      let sy = 1;
      let rot = 0;
      let clip = 'none';
      let blur = 0;
      if (q.kind === 'half') sy = m.enter(clamp01((t - q.at) / 0.5));
      else if (q.kind === 'stripes') {
        const r = `${((1 - m.inOut(k)) * 100).toFixed(2)}%`;
        clip = q.ox === 0 ? `inset(0 ${r} 0 0)` : `inset(0 0 0 ${r})`; // wipes in from its anchored edge
      } else {
        const b = m.bounce(k, 1.7);
        sx = sy = Math.max(0, b) * (1 + q.amp * pulse);
        rot = (1 - b) * q.spin;
        if (k > 0 && k < 1) blur = (1 - m.enter(k)) * 6;
      }
      const w = q.w * sx;
      const h = q.h * sy;
      const shown = k > 0 && w > 0.5 && h > 0.5;
      const st = e.style;
      st.visibility = shown ? 'visible' : 'hidden';
      st.left = px(q.ax - q.ox * w);
      st.top = px(q.ay - q.oy * h);
      st.width = px(w);
      st.height = px(h);
      st.transform = rot ? `rotate(${rot.toFixed(2)}deg)` : 'none';
      st.clipPath = clip;
      st.filter = blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : 'none';
    });
  },
});
