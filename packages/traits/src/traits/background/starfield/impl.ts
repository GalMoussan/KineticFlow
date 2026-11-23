/**
 * Psychedelic-science night (port of dilemma-reel `reel9.js` `drawBackground`). A canvas in `layer.under` is cleared
 * and redrawn from t in every frame: radial base gradient, drifting colour orbs, rotating light rays, a phyllotaxis
 * spiral, an atom with three orbits and electrons, beat rings from the cue sheet's beat grid, rising twinkling stars.
 * Grain and vignette are static, over the layer. Everything is in screen space around the safe area's centre and
 * scaled with the format's short side, so consecutive layers continue the same picture across a cut.
 */
import { hash } from '@reel/runtime';
import { defineBackground, type Layer } from '../../../contract.ts';
import { mixHex, rgbOf } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const ctxs = new WeakMap<Layer, CanvasRenderingContext2D>();
const PULSE_DECAY = 9;
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export default defineBackground({
  meta,
  async mount({ host, layer, params }) {
    const { W, H } = host;
    const PAL = layer.palette;
    const cv = host.el('canvas', 'starfield', layer.under);
    cv.width = W;
    cv.height = H;
    ctxs.set(layer, cv.getContext('2d')!);
    // Grain: faint white specks drawn source-over (no blend mode: ≤ 1/255 GPU render-order residue).
    if (params.grain > 0) {
      const grain = host.el('canvas', 'starfield-grain', layer.over, { width: `${W}px`, height: `${H}px` });
      grain.width = Math.round(W / 2);
      grain.height = Math.round(H / 2);
      const gg = grain.getContext('2d')!;
      const im = gg.createImageData(grain.width, grain.height);
      for (let i = 0; i < grain.width * grain.height; i++) {
        im.data[i * 4] = 255;
        im.data[i * 4 + 1] = 255;
        im.data[i * 4 + 2] = 255;
        im.data[i * 4 + 3] = Math.round(hash(i * 1.37 + 0.5) * params.grain * 255);
      }
      gg.putImageData(im, 0, 0);
      await host.freeze(grain);
    }
    const [r, g, b] = rgbOf(mixHex(PAL.bg, '#000000', 0.5));
    host.el('div', 'starfield-vignette', layer.over, {
      background: `radial-gradient(ellipse 75% 60% at 50% 47%, rgba(${r},${g},${b},0) 55%, rgba(${r},${g},${b},${params.vignette.toFixed(3)}) 100%)`,
    });
  },
  frame({ host, layer, params }, t) {
    const g = ctxs.get(layer);
    if (!g) return;
    const { W, H } = host;
    const PAL = layer.palette;
    const CX = host.safe.cx;
    const CY = host.safe.cy;
    const k = Math.min(W, H) / 1080;
    const R = Math.hypot(W, H);
    const pulse = host.beatPulse(t, PULSE_DECAY);
    const energy = params.energy;

    g.globalCompositeOperation = 'source-over';
    const base = g.createRadialGradient(CX, CY, 50 * k, CX, CY, 0.68 * R);
    base.addColorStop(0, mixHex(PAL.bg, host.accent(4, layer), 0.16));
    base.addColorStop(0.55, mixHex(PAL.bg, '#000000', 0.1));
    base.addColorStop(1, mixHex(PAL.bg, '#000000', 0.6));
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    g.globalCompositeOperation = 'lighter';
    // drifting colour orbs
    const ORBS = [
      { c: host.accent(0, layer), r: 760, sp: 0.23, ox: 300, oy: 420, ph: 0 },
      { c: host.accent(1, layer), r: 700, sp: -0.19, ox: 340, oy: 520, ph: 2.1 },
      { c: host.accent(3, layer), r: 560, sp: 0.31, ox: 260, oy: 380, ph: 4.0 },
      { c: mixHex(host.accent(4, layer), '#000000', 0.45), r: 900, sp: 0.11, ox: 120, oy: 200, ph: 1.0 },
    ];
    // horizontal reach follows the frame's aspect (reel9's offsets are for 1080 × 1920)
    const sx = W / 1080;
    const sy = H / 1920;
    for (const o of ORBS) {
      const a = t * o.sp + o.ph;
      const x = CX + Math.cos(a) * o.ox * sx;
      const y = CY + Math.sin(a * 1.3) * o.oy * sy;
      const [r, gg, b] = rgbOf(o.c);
      const grd = g.createRadialGradient(x, y, 0, x, y, o.r * k);
      grd.addColorStop(0, `rgba(${r},${gg},${b},${(0.2 + 0.1 * pulse).toFixed(3)})`);
      grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }

    // rotating light rays
    const RAYS = 20;
    const rotA = t * 0.18;
    for (let i = 0; i < RAYS; i += 2) {
      const a0 = rotA + (i / RAYS) * TAU;
      const a1 = a0 + Math.PI / RAYS;
      g.beginPath();
      g.moveTo(CX, CY);
      g.lineTo(CX + Math.cos(a0) * R, CY + Math.sin(a0) * R);
      g.lineTo(CX + Math.cos(a1) * R, CY + Math.sin(a1) * R);
      g.closePath();
      g.fillStyle = `hsla(${((i * 18 + t * 50) % 360).toFixed(1)}, 100%, 60%, ${(0.035 + 0.05 * pulse * energy).toFixed(3)})`;
      g.fill();
    }

    // phyllotaxis spiral, slowly rotating and breathing with the beat
    const N = 420;
    const spin = t * 0.25;
    const scale = (30 + 4 * pulse) * k;
    const dotA = (0.16 + 0.12 * energy).toFixed(3);
    for (let i = 1; i < N; i++) {
      const r = Math.sqrt(i) * scale;
      const a = i * GOLDEN + spin;
      g.fillStyle = `hsla(${((i * 1.6 + t * 90) % 360).toFixed(1)}, 100%, 65%, ${dotA})`;
      g.beginPath();
      g.arc(CX + Math.cos(a) * r, CY + Math.sin(a) * r, (2 + (i / N) * 5) * k, 0, TAU);
      g.fill();
    }

    // atom: three orbits with electrons
    g.save();
    g.translate(CX, CY);
    g.lineWidth = 3 * k;
    for (let o = 0; o < 3; o++) {
      g.save();
      g.rotate((o * Math.PI) / 3 + t * 0.12);
      g.strokeStyle = `hsla(${((o * 120 + t * 60) % 360).toFixed(1)}, 100%, 70%, ${(0.2 + 0.15 * pulse).toFixed(3)})`;
      g.beginPath();
      g.ellipse(0, 0, 470 * k, 150 * k, 0, 0, TAU);
      g.stroke();
      const ea = t * (2.2 + o * 0.5) + o * 2;
      const ex = Math.cos(ea) * 470 * k;
      const ey = Math.sin(ea) * 150 * k;
      const eg = g.createRadialGradient(ex, ey, 0, ex, ey, 34 * k);
      eg.addColorStop(0, 'rgba(255,255,255,0.95)');
      eg.addColorStop(0.3, `hsla(${(o * 120 + 40) % 360},100%,65%,0.8)`);
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = eg;
      g.beginPath();
      g.arc(ex, ey, 34 * k, 0, TAU);
      g.fill();
      g.restore();
    }
    g.restore();

    // beat rings: the last four beats of the cue sheet's grid expand from the centre
    const beats = host.reel.cues.beats;
    let nb = -1;
    for (let lo = 0, hi = beats.length - 1; lo <= hi; ) {
      const mid = (lo + hi) >> 1;
      if (beats[mid]! <= t) {
        nb = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let b = nb; b >= 0 && b >= nb - 3; b--) {
      const age = t - beats[b]!;
      const a = Math.max(0, 0.55 - age * 0.32) * energy;
      if (a <= 0) continue;
      g.strokeStyle = `hsla(${(b * 55) % 360}, 100%, 62%, ${a.toFixed(3)})`;
      g.lineWidth = 14 * k * Math.max(0.15, 1 - age * 0.5);
      g.beginPath();
      g.arc(CX, CY, (80 + age * 1500) * k, 0, TAU);
      g.stroke();
    }

    // rising stars
    const stars = Math.round((160 * W * H) / (1080 * 1920));
    for (let i = 0; i < stars; i++) {
      const y = (((hash(i + 500) * H - t * (30 + hash(i + 900) * 140) * k) % H) + H) % H;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 + hash(i + 1700) * 6.28));
      g.fillStyle = `rgba(255,255,255,${(0.6 * tw).toFixed(3)})`;
      g.beginPath();
      g.arc(hash(i) * W, y, (0.8 + hash(i + 1300) * 2.4) * k, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
  /** A pure function of t, the format, palette, params and beat grid (all in the host's fingerprint). */
  fingerprint: () => 'starfield@1',
});
