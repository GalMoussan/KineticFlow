import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { draw, put, svgEl } from '../../../lib/morph/page.ts';
import { mixHex, rgba } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const NS = 'http://www.w3.org/2000/svg';
/** Sun bands (gaps in its lower half), grid rows in view, streaks in the tracking band. */
const BANDS = 7;
const ROWS = 18;
const STREAKS = 4;
/** Far end of the floor (depth units; the nearest row is at 1). */
const FAR = 26;
/** The horizon cuts the sun this far (× radius) below its centre. */
const SUN_DIP = 0.45;

interface Els {
  stripes: SVGRectElement[];
  glow: SVGPathElement;
  core: SVGPathElement;
  band: HTMLElement;
  streaks: HTMLElement[];
  clock: HTMLElement;
}
const els = new WeakMap<Layer, Els>();

/** Beats elapsed at t (fractional), from the cue sheet's beat grid; before the first beat, time at its first period. */
function beatsAt(beats: readonly number[], t: number): number {
  if (beats.length < 2) return t * 2;
  const p0 = beats[1]! - beats[0]!;
  if (t < beats[0]!) return (t - beats[0]!) / p0;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  const next = beats[lo + 1];
  const p = next !== undefined ? next - beats[lo]! : beats[lo]! - beats[lo - 1]!;
  return lo + (t - beats[lo]!) / p;
}

/** Tracking slip strength 0..1 around the layer's incoming scene change (its window, a little before and after). */
function slip(layer: Layer, t: number): number {
  const w = layer.sections[0]!.window;
  if (!w) return 0;
  const a = w.t0 - 0.1;
  const b = w.t1 + 0.25;
  return t >= a && t < b ? 1 - (t - a) / (b - a) : 0;
}

export default defineBackground({
  meta,
  mount({ host, layer, params }) {
    const { W, H } = host;
    const { bg, text } = layer.palette;
    const [a0, a1, a2, a3] = [0, 1, 2, 3].map((i) => host.accent(i, layer)) as [string, string, string, string];
    const hy = Math.round(params.horizon * H);
    const D = Math.min(W, H);
    // sky down to the horizon, the dark floor below it
    host.el('div', 'sg-fill', layer.under, {
      background:
        `linear-gradient(180deg, ${mixHex(bg, '#000000', 0.3)} 0px, ${bg} ${(hy * 0.35).toFixed(0)}px, ${mixHex(bg, a3, 0.45)} ${(hy * 0.78).toFixed(0)}px, ` +
        `${mixHex(a0, bg, 0.25)} ${hy}px, ${mixHex(bg, '#000000', 0.35)} ${hy}px, ${mixHex(bg, a3, 0.12)} ${H}px)`,
    });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sg-svg');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    layer.under.appendChild(svg);
    host.own(svg);
    const id = `sg${layer.index}`;
    const defs = svgEl('defs', svg);
    // stars in the upper sky (static)
    for (let i = 0; i < 40; i++) {
      const r = 1 + 2 * hash(layer.index * 7 + i * 3.1);
      svgEl('circle', svg, { cx: (hash(i * 1.7 + 0.3) * W).toFixed(1), cy: (hash(i * 2.9 + 0.7) * hy * 0.7).toFixed(1), r: r.toFixed(1), fill: text, 'fill-opacity': (0.25 + 0.5 * hash(i * 5.3)).toFixed(2) });
    }
    const R = params.sun * D;
    const stripes: SVGRectElement[] = [];
    if (R > 0) {
      const cy = hy - SUN_DIP * R;
      const glow = svgEl('radialGradient', defs, { id: `${id}g` });
      svgEl('stop', glow, { offset: '0.55', 'stop-color': a0, 'stop-opacity': '0.45' });
      svgEl('stop', glow, { offset: '1', 'stop-color': a0, 'stop-opacity': '0' });
      svgEl('circle', svg, { cx: String(W / 2), cy: cy.toFixed(1), r: (R * 1.9).toFixed(1), fill: `url(#${id}g)` });
      const sun = svgEl('linearGradient', defs, { id: `${id}s`, x1: '0', y1: '0', x2: '0', y2: '1' });
      svgEl('stop', sun, { offset: '0', 'stop-color': mixHex(a1, '#FFFFFF', 0.35) });
      svgEl('stop', sun, { offset: '0.45', 'stop-color': a1 });
      svgEl('stop', sun, { offset: '1', 'stop-color': a0 });
      // the sun shows through its clip: the solid top plus the bands between the scrolling gaps
      const clip = svgEl('clipPath', defs, { id: `${id}c` });
      stripes.push(svgEl('rect', clip, { x: String(W / 2 - R), y: (cy - R).toFixed(1), width: (2 * R).toFixed(1), height: R.toFixed(1) }));
      for (let i = 0; i < BANDS; i++) stripes.push(svgEl('rect', clip, { x: String(W / 2 - R), width: (2 * R).toFixed(1) }));
      svgEl('circle', svg, { cx: String(W / 2), cy: cy.toFixed(1), r: R.toFixed(1), fill: `url(#${id}s)`, 'clip-path': `url(#${id}c)` });
    }
    // grid: a wide soft stroke under a thin bright one, both fading into the horizon
    const fade = svgEl('linearGradient', defs, { id: `${id}f`, gradientUnits: 'userSpaceOnUse', x1: '0', y1: String(hy), x2: '0', y2: String(H) });
    svgEl('stop', fade, { offset: '0', 'stop-color': a0, 'stop-opacity': '0.15' });
    svgEl('stop', fade, { offset: '0.35', 'stop-color': a0, 'stop-opacity': '0.85' });
    svgEl('stop', fade, { offset: '1', 'stop-color': mixHex(a0, '#FFFFFF', 0.2), 'stop-opacity': '1' });
    const lw = Math.max(1.5, D / 380);
    const glowP = svgEl('path', svg, { fill: 'none', stroke: a3, 'stroke-opacity': '0.35', 'stroke-width': (lw * 4).toFixed(1) });
    const core = svgEl('path', svg, { fill: 'none', stroke: `url(#${id}f)`, 'stroke-width': lw.toFixed(1) });
    svgEl('rect', svg, { x: '0', y: (hy - lw).toFixed(1), width: String(W), height: (lw * 2).toFixed(1), fill: mixHex(a0, '#FFFFFF', 0.5) });

    // VHS: scanlines, tracking band with streaks, vignette, OSD
    const v = params.vhs;
    host.el('div', 'sg-scan', layer.over, {
      background: `repeating-linear-gradient(180deg, ${rgba('#000000', 0.22 * v)} 0px, ${rgba('#000000', 0.22 * v)} 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 5px)`,
    });
    host.el('div', 'sg-vignette', layer.over, {
      background: `radial-gradient(ellipse 75% 65% at 50% 50%, rgba(0,0,0,0) 55%, ${rgba('#000000', 0.55 * v)} 100%)`,
    });
    const band = host.el('div', 'sg-band', layer.over);
    const streaks = Array.from({ length: STREAKS }, () => host.el('div', 'sg-streak', band));
    const osd = host.el('div', 'sg-osd', layer.over, {
      left: `${Math.round(Math.max(24, host.safe.left * 0.6))}px`,
      top: `${Math.round(Math.max(18, host.safe.top * 0.3))}px`,
      'font-size': `${Math.round(D * 0.034)}px`,
      color: text,
      'text-shadow': `0 0 ${Math.round(D * 0.008)}px ${a2}`,
      opacity: v > 0 ? '0.85' : '0',
    });
    host.el('span', 'sg-play', osd, { 'border-left-color': text });
    host.el('span', 'sg-word', osd).textContent = 'PLAY';
    const clock = host.el('div', 'sg-clock', osd);
    els.set(layer, { stripes, glow: glowP, core, band, streaks, clock });
  },
  frame({ host, layer, params }, t) {
    const e = els.get(layer)!;
    const { W, H } = host;
    const hy = Math.round(params.horizon * H);
    const D = Math.min(W, H);
    const nb = beatsAt(host.reel.cues.beats, t);
    // sun bands: gaps scroll down between its centre and the horizon, growing as they go; nothing shows below it
    const R = params.sun * D;
    if (R > 0) {
      const cy = hy - SUN_DIP * R;
      const span = hy - cy;
      const ph = (((nb * 0.25) % 1) + 1) % 1;
      e.stripes.forEach((r, i) => {
        if (i === 0) return;
        const k = (i - 1 + ph) / BANDS;
        const top = cy + span * k;
        const gap = span * (0.03 + 0.2 * k);
        const next = cy + span * ((i + ph) / BANDS);
        put(r, 'y', (top + gap).toFixed(2));
        put(r, 'height', Math.max(0, Math.min(next, hy) - top - gap).toFixed(2));
      });
      // the solid part ends where the first gap starts
      put(e.stripes[0]!, 'height', (R + (span * ph) / BANDS).toFixed(2));
    }
    // floor: verticals converge on the vanishing point; rows at depth z ∈ (1, FAR) sit at hy + (H − hy)/z
    const cx = W / 2;
    let d = '';
    const spread = W * 0.16;
    for (let i = -14; i <= 14; i++) d += `M${(cx + i * spread * 0.04).toFixed(1)},${hy}L${(cx + i * spread).toFixed(1)},${H}`;
    const off = (((nb * params.speed) % 1) + 1) % 1;
    for (let k = 0; k < ROWS; k++) {
      const z = 1 + Math.pow(k + 1 - off, 1.35) * ((FAR - 1) / Math.pow(ROWS, 1.35));
      const y = hy + (H - hy) / z;
      d += `M0,${y.toFixed(1)}L${W},${y.toFixed(1)}`;
    }
    draw(e.glow, d, 'none', 1);
    draw(e.core, d, 'none', 1);
    // tracking band drifts down the frame; at scene changes it tears wide and the picture slips sideways
    const sl = slip(layer, t);
    const f = Math.floor(t * 30);
    const bandH = H * (0.045 + 0.12 * sl);
    const by = ((t * 0.09 + 0.3 * hash(layer.index)) % 1) * (H + bandH) - bandH;
    const bs = e.band.style;
    bs.top = `${by.toFixed(1)}px`;
    bs.height = `${bandH.toFixed(1)}px`;
    bs.opacity = (params.vhs * (0.5 + 0.5 * sl)).toFixed(3);
    e.streaks.forEach((s, i) => {
      const h = (k: number) => hash(f * 13 + i * 7 + k);
      const st = s.style;
      st.top = `${(h(1) * 100).toFixed(1)}%`;
      st.left = `${(h(2) * 70).toFixed(1)}%`;
      st.width = `${(10 + h(3) * 40).toFixed(1)}%`;
      st.opacity = (0.3 + 0.7 * h(4)).toFixed(3);
    });
    if (sl > 0 && params.jitter > 0 && hash(f * 3.7 + layer.index) < 0.65) {
      host.stageCh.shakeX += Math.round((hash(f * 5.1 + 2) - 0.5) * 2 * params.jitter * sl);
    }
    const s = Math.floor(t);
    const clock = `SP ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}:${String(Math.floor((t - s) * 30)).padStart(2, '0')}`;
    if (e.clock.textContent !== clock) e.clock.textContent = clock;
  },
});
