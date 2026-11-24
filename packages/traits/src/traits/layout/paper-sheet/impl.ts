/**
 * The sheet, its shade and its crease are decoration units. Every frame rewrites left/top/width/height (whole
 * px from `foldBox`), the corner radius and the background. Shade opacity goes through the channel: commit
 * overwrites `el.style.opacity`. The sheet colour is the palette's text (cream on paper-desk); the reveal
 * inks the words dark so they read on that sheet.
 */
import { defineLayout, type Unit } from '../../../contract.ts';
import { safeFit } from '../../../lib/rowset.ts';
import { centredBlock, foldBox, foldK, foldWindows } from '../../../lib/scroll.ts';
import { meta } from './meta.ts';

interface Sheet {
  panel: { x: number; y: number; w: number; h: number };
  axis: 'x' | 'y';
  accent: string;
  paper: string;
}

const px = (n: number) => `${Math.round(n)}px`;

export default defineLayout({
  meta,
  layout({ host, layer, params }) {
    const { safe } = host;
    const fit = safeFit(host);
    const cap = Math.min(params.cap * safe.w, 0.42 * (fit.y1 - fit.y0));
    for (const s of layer.sections) {
      centredBlock(host, s, fit, { cap, plain: params.plain, leading: params.leading });
      s.place = { x: 0, y: 0, rot: 0 };
      s.frame = { x: safe.cx, y: safe.cy, r: 0, s: 1 };
      const panel = { x: Math.round(safe.left), y: Math.round(safe.top), w: Math.round(safe.w), h: Math.round(safe.h) };
      s.bounds = { x0: panel.x, y0: panel.y, x1: panel.x + panel.w, y1: panel.y + panel.h };
      const accent = host.accent(s.index % 3, s);
      const paper = s.palette.text;
      s.data.layout = { panel, axis: s.index % 2 ? 'x' : 'y', accent, paper } satisfies Sheet;
      const box = { x: panel.x, y: panel.y, w: panel.w, h: panel.h };
      host.deco(s, { deco: 'sheet', box: { ...box }, z: -3, style: { 'box-sizing': 'border-box' } });
      host.deco(s, { deco: 'shade', box: { ...box }, z: -2, style: { 'box-sizing': 'border-box' } });
      host.deco(s, { deco: 'crease', box: { ...box }, z: -1, style: { 'box-sizing': 'border-box' } });
    }
  },
  frame({ layer }, t) {
    for (const s of layer.sections) {
      const d = s.data.layout as Sheet;
      const next = s.next?.window ?? null;
      const w = foldWindows(s.timing.in, s.timing.holdStart, s.timing.out, s.window, next);
      const k = foldK(t, w);
      const { panel, axis } = d;
      const fold = foldBox(axis === 'y' ? panel.h : panel.w, k);
      const width = axis === 'x' ? fold.size : panel.w;
      const height = axis === 'y' ? fold.size : panel.h;
      const x = axis === 'x' ? panel.x + fold.inset : panel.x;
      const y = axis === 'y' ? panel.y + fold.inset : panel.y;
      const radius = Math.min(18, width / 2, height / 2);
      const along = axis === 'y' ? 'to bottom' : 'to right';
      const edge = Math.min(10, Math.max(2, Math.round(Math.min(width, height) / 2)));
      for (const u of s.units) {
        if (u.deco === 'sheet') {
          paint(u, x, y, width, height, radius, `linear-gradient(${along}, ${d.accent} 0px, ${d.accent} ${edge}px, ${d.paper} ${edge}px)`);
        } else if (u.deco === 'shade') {
          paint(u, x, y, width, height, radius, axis === 'y'
            ? 'linear-gradient(to bottom, transparent, rgba(28,23,20,0.42) 50%, transparent)'
            : 'linear-gradient(to right, transparent, rgba(28,23,20,0.42) 50%, transparent)');
          u.ch.opacity *= 1 - k;
          u.ch.visible &&= k < 0.995;
        } else if (u.deco === 'crease') {
          const horizontal = axis === 'y';
          paint(
            u,
            horizontal ? panel.x : panel.x + Math.round(panel.w / 2) - 1,
            horizontal ? panel.y + Math.round(panel.h / 2) - 1 : panel.y,
            horizontal ? panel.w : 2,
            horizontal ? 2 : panel.h,
            0,
            d.accent,
          );
          u.ch.opacity *= 1 - k;
          u.ch.visible &&= k < 0.995;
        }
      }
    }
  },
});

/** Geometry that changes with the fold. Written every frame; commit does not reset these properties. */
function paint(u: Unit, x: number, y: number, w: number, h: number, radius: number, background: string): void {
  const el = u.el;
  if (!el) return;
  const st = el.style;
  st.left = px(x);
  st.top = px(y);
  st.width = px(Math.max(1, w));
  st.height = px(Math.max(1, h));
  st.borderRadius = px(radius);
  st.background = background;
}
