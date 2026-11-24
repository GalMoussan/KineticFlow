/**
 * Page turn (see meta). The clip, the edge and the shadow are rewritten every frame from t alone. RTL reveals from
 * the right (inset on the left); LTR from the left. The edge sits on the not-yet-revealed side of the clip so the
 * incoming layer, painted above it, does not cover it.
 */
import type { SoundCue } from '@reel/core';
import { clamp01 } from '@reel/runtime';
import { defineTransition, type Section } from '../../../contract.ts';
import { meta } from './meta.ts';

interface Leaf {
  shade: HTMLElement;
  edge: HTMLElement;
}

const leaves = new Map<Section, Leaf>();

export default defineTransition({
  meta,
  mount({ host, section }) {
    if (!section.window || !section.prev || section.layer.sections[0] !== section) return;
    const shade = host.el('div', 'page-shade', null);
    const edge = host.el('div', 'page-edge', null);
    host.stage.insertBefore(shade, section.layer.el);
    host.stage.insertBefore(edge, section.layer.el);
    leaves.set(section, { shade, edge });
  },
  frame({ host }, t) {
    const { W } = host;
    const band = Math.max(28, Math.round(W * 0.055));
    for (const [s, leaf] of leaves) {
      const w = s.window!;
      const inside = t >= w.t0 && t < w.t1;
      const p = inside ? s.motion.inOut(clamp01((t - w.t0) / (w.t1 - w.t0))) : 0;
      const on = inside && p > 0.001 && p < 0.999;
      const rtl = s.dir === 'rtl';
      const edgeX = rtl ? (1 - p) * W : p * W;
      leaf.shade.style.display = on ? 'block' : 'none';
      leaf.edge.style.display = on ? 'block' : 'none';
      if (!on) continue;
      const lift = Math.sin(Math.PI * p);
      leaf.shade.style.width = `${band}px`;
      leaf.shade.style.left = `${(rtl ? edgeX - band : edgeX).toFixed(2)}px`;
      leaf.shade.style.opacity = (lift).toFixed(3);
      leaf.shade.style.background = rtl
        ? `linear-gradient(to left, rgba(0,0,0,${(0.45).toFixed(2)}), rgba(0,0,0,0))`
        : `linear-gradient(to right, rgba(0,0,0,${(0.45).toFixed(2)}), rgba(0,0,0,0))`;
      leaf.edge.style.width = '4px';
      leaf.edge.style.left = `${(rtl ? edgeX - 4 : edgeX).toFixed(2)}px`;
      leaf.edge.style.background = s.palette.bg;
      leaf.edge.style.opacity = '1';
    }
  },
  between({ host, section, params }, w, t) {
    const win = section.window!;
    const p = section.motion.inOut(clamp01((t - win.t0) / (win.t1 - win.t0)));
    const rtl = section.dir === 'rtl';
    const q = `${((1 - p) * 100).toFixed(3)}%`;
    w.incoming.ch.clip = p >= 1 ? null : rtl ? `inset(0 0 0 ${q})` : `inset(0 ${q} 0 0)`;
    const o = w.outgoing.ch;
    const push = params.push * host.W * p;
    if (rtl) o.tx += push;
    else o.tx -= push;
    o.blur += Math.sin(Math.PI * p) * params.blur;
    // `shade` scales the shadow element written in `frame` (that element reads the param via the section).
    const leaf = leaves.get(section);
    if (leaf && p > 0 && p < 1) leaf.shade.style.opacity = (Math.sin(Math.PI * p) * params.shade).toFixed(3);
  },
  /** One whoosh as the page turns. The first section has no window, so nothing plays under the music fade-in. */
  sounds({ section }) {
    const w = section.window;
    if (!w || !section.prev) return [];
    const t = Math.max(0.6, w.t0);
    if (t >= w.t1) return [];
    return [{ t, until: w.t1, kind: 'whoosh', weight: 0.45, pan: section.dir === 'rtl' ? 0.25 : -0.25 } satisfies SoundCue];
  },
});
