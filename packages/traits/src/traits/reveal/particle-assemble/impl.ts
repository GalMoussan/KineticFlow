/**
 * Particle assemble. `mount` rasterises every text unit's own text (font, size, weight, direction, kerning as the
 * DOM) into a software canvas, samples its ink on a grid and freezes the points (group coordinates) as the unit's
 * particle set. `frame` clears the section's canvas in `layer.over` and draws, from t alone: ambient dust; every
 * particle on its way from a ring around the unit (swirling about the unit's centre) onto its ink point; the DOM
 * text fading in as they land (particles fading out, so the hold shows only the real text); and on exits the text
 * handing back to particles that blow apart.
 */
import type { SoundCue } from '@reel/core';
import { clamp01, hash } from '@reel/runtime';
import { defineReveal, type Section, type Unit } from '../../../contract.ts';
import { exitWindow } from '../../../lib/neon.ts';
import { frameCanvas, groupToScreen } from '../../../lib/overlay.ts';
import { endcardStinger } from '../../../lib/sound.ts';
import { subLanding } from '../../../lib/subline.ts';
import { meta } from './meta.ts';

interface Data {
  anim: 'particles' | 'fade';
}
interface Cloud {
  x: Float32Array;
  y: Float32Array;
  /** Particle half-size, px. */
  r: number;
  /** Ink centre (group coordinates): the swirl's pivot. */
  cx: number;
  cy: number;
}
const clouds = new WeakMap<Unit, Cloud>();
const ctxs = new WeakMap<Section, CanvasRenderingContext2D>();
const TAU = Math.PI * 2;
/** Most particles per unit at density 1. */
const CAP = 900;
/** Every SPARK-th particle takes the accent colour. */
const SPARK = 6;

let sampler: CanvasRenderingContext2D | null = null;

/** The unit's ink as a jittered grid of points in group coordinates (Canvas2D in software: identical in every run). */
function sample(fam: string, u: Unit, dir: 'rtl' | 'ltr', density: number): Cloud | null {
  sampler ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const g = sampler;
  const S = u.font.size;
  const font = `${u.font.weight} ${S}px "${fam}"`;
  g.font = font;
  g.direction = u.ltr ? 'ltr' : dir;
  g.fontKerning = 'normal';
  const mt = g.measureText(u.text);
  const fa = mt.fontBoundingBoxAscent;
  const fd = mt.fontBoundingBoxDescent;
  const pad = Math.ceil(0.45 * S);
  const cw = Math.ceil(mt.width + 2 * pad);
  const chh = Math.ceil(fa + fd + 2 * pad);
  g.canvas.width = cw;
  g.canvas.height = chh;
  // resizing resets the context state
  g.font = font;
  g.direction = u.ltr ? 'ltr' : dir;
  g.fontKerning = 'normal';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#FFFFFF';
  g.fillText(u.text, pad, pad + fa);
  const data = g.getImageData(0, 0, cw, chh).data;
  const step = Math.max(2, Math.round(S / (19 * Math.sqrt(density))));
  const pts: number[] = [];
  for (let y = Math.floor(step / 2); y < chh; y += step) {
    for (let x = Math.floor(step / 2); x < cw; x += step) if (data[(y * cw + x) * 4 + 3]! > 110) pts.push(x, y);
  }
  const total = pts.length / 2;
  if (!total) return null;
  const keep = Math.min(1, (CAP * density) / total);
  // inner element: line-height 1, so the baseline sits S/2 + (fa − fd)/2 below its top
  const left = u.box.x + u.textAt.x - pad;
  const top = u.box.y + u.textAt.y + S / 2 + (fa - fd) / 2 - (pad + fa);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < total; i++) {
    if (keep < 1 && hash(i * 0.917 + u.id * 3.1) >= keep) continue;
    xs.push(left + pts[2 * i]! + (hash(i * 1.37 + 0.1) - 0.5) * step * 0.8);
    ys.push(top + pts[2 * i + 1]! + (hash(i * 2.11 + 0.4) - 0.5) * step * 0.8);
  }
  const n = xs.length;
  return {
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    r: step * 0.36,
    cx: xs.reduce((a, v) => a + v, 0) / n,
    cy: ys.reduce((a, v) => a + v, 0) / n,
  };
}

export default defineReveal({
  meta,
  prepare(_c, u) {
    u.data.reveal = { anim: u.text && u.font.size > 0 ? 'particles' : 'fade' } satisfies Data;
  },
  mount({ host, section, params }) {
    ctxs.set(section, frameCanvas(host, 'particles', section.layer.over));
    for (const u of section.units) {
      if (!u.revealed || (u.data.reveal as Data).anim !== 'particles') continue;
      const cloud = sample(host.families[u.font.family], u, section.dir, params.density);
      if (cloud) clouds.set(u, cloud);
    }
  },
  frame({ host, section, params }, t) {
    const g = ctxs.get(section);
    if (!g) return;
    const { W, H } = host;
    const short = Math.min(W, H);
    const k1 = short / 1080;
    const m = section.motion;
    const ex = exitWindow(section);
    const exDur = ex ? Math.min(params.exit, ex.t1 - ex.t0) : 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);

    if (params.dust > 0) {
      const count = Math.round((70 * W * H) / (1080 * 1920));
      for (let j = 0; j < count; j++) {
        const x = hash(j * 1.31 + 0.2) * W + Math.sin(t * 0.4 + j) * 18 * k1;
        const y = (((hash(j * 2.93 + 0.5) * H - t * (10 + 25 * hash(j + 3.3)) * k1) % H) + H) % H;
        const s = (1 + 2 * hash(j * 4.7 + 0.9)) * k1;
        g.globalAlpha = 0.22 * params.dust * (0.55 + 0.45 * Math.sin(t * 1.7 + j * 2.1));
        g.fillStyle = j % 3 ? section.palette.text : host.accent(0, section);
        g.fillRect(x - s, y - s, 2 * s, 2 * s);
      }
    }

    g.setTransform(...groupToScreen(host, section));
    for (const u of section.units) {
      if (!u.revealed) continue;
      const c = u.ch;
      const cl = clouds.get(u);
      const kx = ex && t >= ex.t0 ? clamp01((t - ex.t0) / exDur) : 0;
      // the text hands over to the particles in the first third of the exit
      const out = clamp01(kx / 0.3);
      if (!cl) {
        const k = clamp01((t - (u.at - 0.3)) / 0.5);
        c.visible &&= k > 0;
        c.opacity *= k * (1 - m.exit(kx));
        c.ity += (1 - m.enter(k)) * 0.1 * u.box.h;
        continue;
      }
      const L = u.at;
      const tin = clamp01((t - (L - 0.5 * params.fade)) / params.fade);
      c.opacity *= tin * (1 - out);
      c.visible &&= tin * (1 - out) > 0;
      const n = cl.x.length;
      const col = c.color ?? u.color;
      const spark = host.accent(u.tags.hero ? 1 : 0, section);
      if (tin < 1) {
        const fade = 1 - tin;
        // the small line gathers from close by, quicker and tighter (a calmer assemble)
        const sub = u.kind === 'sub';
        const fly = sub ? 0.6 * params.fly : params.fly;
        const spread = sub ? 0.5 * params.spread : params.spread;
        const reach = sub ? 0.3 * params.reach : params.reach;
        const t0 = L - fly - spread;
        for (let pass = 0; pass < 2; pass++) {
          g.fillStyle = pass ? spark : col;
          for (let i = pass ? 0 : 1; i < n; i += pass ? SPARK : 1) {
            if (!pass && i % SPARK === 0) continue;
            const k = (t - t0 - hash(i * 0.737 + u.id * 1.31) * spread) / fly;
            if (k <= 0) continue;
            const e = k >= 1 ? 1 : 0.5 * m.enter(k) + 0.5 * m.inOut(k);
            const a0 = hash(i * 1.913 + u.id * 0.37) * TAU;
            const r0 = reach * short * (0.45 + 0.55 * hash(i * 3.17 + u.id * 0.11));
            const sx = cl.cx + Math.cos(a0) * r0;
            const sy = cl.cy + Math.sin(a0) * r0;
            const px = sx + (cl.x[i]! - sx) * e - cl.cx;
            const py = sy + (cl.y[i]! - sy) * e - cl.cy;
            const th = (1 - e) * params.swirl;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const x = cl.cx + px * cs - py * sn;
            const y = cl.cy + px * sn + py * cs;
            const r = cl.r * (1 + 1.3 * (1 - e)) * (pass ? 1.4 : 1);
            g.globalAlpha = clamp01(k * 4) * fade * (0.65 + 0.35 * hash(i * 5.9 + 0.3));
            g.fillRect(x - r, y - r, 2 * r, 2 * r);
          }
        }
      }
      if (out > 0) {
        const q = m.exit(kx);
        for (let pass = 0; pass < 2; pass++) {
          g.fillStyle = pass ? spark : col;
          for (let i = pass ? 0 : 1; i < n; i += pass ? SPARK : 1) {
            if (!pass && i % SPARK === 0) continue;
            const b = hash(i * 4.13 + u.id * 0.7) * TAU;
            const d = q * (0.12 + 0.4 * hash(i * 5.31 + 0.2)) * short;
            const x = cl.x[i]! + Math.cos(b) * d + Math.sin(i + q * 6) * 6 * k1 * q;
            const y = cl.y[i]! + Math.sin(b) * d - q * 0.14 * short;
            const r = cl.r * (1 - 0.5 * q) * (pass ? 1.4 : 1);
            g.globalAlpha = out * (1 - q) * (0.65 + 0.35 * hash(i * 5.9 + 0.3));
            g.fillRect(x - r, y - r, 2 * r, 2 * r);
          }
        }
      }
    }
    g.globalAlpha = 1;
  },
  /** The exit is drawn by the section's own units and canvas, but its window starts at the section's `out`. */
  fingerprint({ section, params }, t0, t1) {
    const ex = exitWindow(section);
    return ex && ex.t0 < t1 && ex.t1 >= t0 ? { ...ex, d: Math.min(params.exit, ex.t1 - ex.t0) } : null;
  },
  /**
   * A riser while the first word gathers (not inside the music's fade-in), a pop per landing with the pitch rising
   * through the section, a light tick per sub word, a whoosh and a sparkle as the words blow apart.
   */
  sounds({ host, section, params }) {
    const out: SoundCue[] = endcardStinger(section, 0.8);
    const content = section.units.filter((u) => u.revealed && u.item >= 0 && Number.isFinite(u.at) && u.kind !== 'sub');
    const first = content[0];
    const rise = first ? first.at - params.fly * 0.8 : -1;
    if (first && rise >= 0.6) out.push({ t: rise, until: first.at, kind: 'riser', weight: 0.3 });
    content.forEach((u, i) =>
      out.push({ t: u.at, kind: 'pop', weight: u.tags.hero || u.emphasis ? 0.55 : 0.38, pitch: Math.min(7, i), pan: host.pan(u) }),
    );
    section.units
      .filter((u) => u.revealed && u.item >= 0 && Number.isFinite(u.at) && u.kind === 'sub')
      .forEach((u, i) => {
        const c = subLanding(u.at, i, host.pan(u));
        if (c) out.push(c);
      });
    const ex = exitWindow(section);
    if (ex) {
      out.push({ t: ex.t0, until: ex.t0 + Math.min(params.exit, ex.t1 - ex.t0), kind: 'whoosh', weight: 0.42 });
      out.push({ t: ex.t0 + 0.05, kind: 'shimmer', weight: 0.3 });
    }
    return out;
  },
});
