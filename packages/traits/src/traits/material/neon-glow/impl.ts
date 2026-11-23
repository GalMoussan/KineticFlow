/**
 * Neon material (port of dilemma-reel `reel9.js`): fills and glow colours per unit tag, a glow that breathes with the
 * beat, the reveal's RGB split scaled by `split`, and an FX canvas (`layer.over`) with spark bursts and shock rings
 * at the impacts of the layer's sections.
 *
 * The canvas belongs to the first neon-glow section of its layer, which draws the bursts of every neon-glow section
 * of the layer (one clear per frame, nothing accumulates). Bursts live in `section.data.material` (layer
 * coordinates) and are reported from `fingerprint()` while they are alive in the window.
 */
import { clamp01, expo, hash } from '@reel/runtime';
import { defineMaterial, type Host, type Layer, type Section, type Unit } from '../../../contract.ts';
import { hueOf, rainbow } from '../../../lib/neon.ts';
import { meta } from './meta.ts';

const EM = 280; // reel9's typical font size
const LIFE = 1.6; // s a burst stays alive

interface Tone {
  glow: string;
  rainbow: boolean;
}
interface Burst {
  t: number;
  x: number;
  y: number;
  n: number;
  hue: number;
  /** Size scale (font size / EM). */
  k: number;
}

const ownerOf = (layer: Layer): Section | undefined => layer.sections.find((s) => s.style.traits.material === 'neon-glow');
const fx = new WeakMap<Layer, CanvasRenderingContext2D>();

/** Fill + glow by tag (reel9's colour script): hero rainbow, emphasis rotating hot accents, numbers yellow/teal. */
function tone(host: Host, u: Unit): { fill: string; t: Tone } {
  const A = (i: number) => host.accent(i, u.section);
  const T = u.section.palette.text;
  const of = (fill: string, glow: string, rb = false) => ({ fill, t: { glow, rainbow: rb } });
  if (u.tags.hero) return of(T, A(4), true);
  switch (u.kind) {
    case 'date':
    case 'stat':
    case 'countdown':
      return of(A(2), A(0));
    case 'time':
    case 'city':
      return of(A(1), A(1));
    case 'weekday':
      return of(T, A(1));
    case 'list-title':
      return of(A(2), A(3));
  }
  if (u.tags.ordinal >= 0) {
    const o = u.tags.ordinal % 4;
    return o === 0 ? of(A(3), A(0)) : o === 1 ? of(T, A(0), true) : o === 2 ? of(A(0), A(0)) : of(A(2), A(3));
  }
  if (u.section.role === 'endcard') return of(A(2), A(3));
  // plain words alternate white / accent fills (reel9: white, yellow, teal), each with its own glow
  const k = u.item % 4;
  return k === 1 ? of(A(2), A(3)) : k === 3 ? of(A(1), A(1)) : of(T, A(k === 0 ? 0 : 4));
}

export default defineMaterial({
  meta,
  prepare({ host }, u) {
    if (u.item < 0 || u.kind === 'logos') return;
    const { fill, t } = tone(host, u);
    u.color = fill;
    u.data.material = t;
  },
  setup({ host, section, params }) {
    if (!params.burst) return;
    const bursts: Burst[] = [];
    for (const u of section.units) {
      const strong = u.hit || (u.item >= 0 && (u.tags.hero || u.tags.ordinal >= 0 || (u.tags.numeric && u.kind !== 'time')));
      if (!strong || !Number.isFinite(u.at)) continue;
      const tn = u.data.material as Tone | undefined;
      const hue = hueOf(tn?.glow ?? host.accent(0, section));
      // impact point: the ink centre (or the box centre), in layer coordinates
      const ink = u.inkBox;
      const lx = u.box.x + (ink ? u.textAt.x + ink.x + ink.w / 2 : u.box.w / 2);
      const ly = u.box.y + (ink ? u.textAt.y + ink.y + ink.h / 2 : u.box.h / 2);
      const p = section.place;
      const a = (p.rot * Math.PI) / 180;
      const k = Math.max(0.3, u.font.size / EM);
      bursts.push({
        t: u.hit ? u.hit.t : u.at + 0.1,
        x: p.x + lx * Math.cos(a) - ly * Math.sin(a),
        y: p.y + lx * Math.sin(a) + ly * Math.cos(a),
        n: Math.round(40 + 30 * k + (u.tags.hero ? 40 : 0)),
        hue,
        k,
      });
    }
    section.data.material = { bursts };
  },
  mount({ host, layer, section }) {
    if (ownerOf(layer) !== section) return;
    const cv = host.el('canvas', 'neon-fx', layer.over);
    cv.width = host.W;
    cv.height = host.H;
    fx.set(layer, cv.getContext('2d')!);
  },
  frame({ host, layer, section, params }, t) {
    const pulse = section.pulse(t);
    for (const u of section.units) {
      const tn = u.data.material as Tone | undefined;
      if (!tn) continue;
      const S = u.font.size / EM;
      const g = params.glow * (18 + 20 * pulse) * S;
      if (u.parts.length) {
        u.parts.forEach((p, i) => {
          const pc = p.ch;
          pc.glow += g;
          pc.glowColor = tn.rainbow ? rainbow(i + u.item + 2, t, 55) : tn.glow;
          if (tn.rainbow) pc.color = rainbow(i + u.item, t);
          pc.split = Math.round(pc.split * params.split);
        });
      } else {
        u.ch.glow += g;
        u.ch.glowColor = tn.rainbow ? rainbow(u.item + 2, t, 55) : tn.glow;
        if (tn.rainbow) u.ch.color = rainbow(u.item, t);
      }
      // whole-pixel offsets: fractional split shadows raster differently with the GPU tile state (seek order)
      u.ch.split = Math.round(u.ch.split * params.split);
    }
    if (ownerOf(layer) === section) drawFx(host, layer, t);
  },
  /** The owner reports every burst of the layer alive in the window (the canvas draws them all). */
  fingerprint({ layer, section }, t0, t1) {
    if (ownerOf(layer) !== section) return null;
    return { bursts: liveBursts(layer, t0, t1) };
  },
});

function liveBursts(layer: Layer, t0: number, t1: number): { burst: Burst; strength: number }[] {
  return layer.sections.flatMap((s) => {
    if (s.style.traits.material !== 'neon-glow') return [];
    const strength = s.style.params['material.burst'] ?? 1;
    const bs = (s.data.material as { bursts: Burst[] } | undefined)?.bursts ?? [];
    return bs.filter((b) => b.t < t1 && b.t + LIFE >= t0).map((burst) => ({ burst, strength }));
  });
}

/** Clears the layer's FX canvas and draws the bursts alive at t (screen space through the layer's camera). */
function drawFx(host: Host, layer: Layer, t: number): void {
  const g = fx.get(layer);
  if (!g) return;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, host.W, host.H);
  const live = liveBursts(layer, t - 1e-9, t + 1e-9).filter(({ burst: b }) => t >= b.t);
  if (!live.length) return;
  const v = layer.view;
  const ar = (-v.r * Math.PI) / 180;
  const [ca, sa] = [Math.cos(ar), Math.sin(ar)];
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  live.forEach(({ burst: b, strength }, bi) => {
    const age = t - b.t;
    const dx = b.x - v.x;
    const dy = b.y - v.y;
    const x = host.safe.cx + v.s * (dx * ca - dy * sa);
    const y = host.safe.cy + v.s * (dx * sa + dy * ca);
    const k = b.k * v.s;
    // shock ring
    const kr = clamp01(age / 0.8);
    if (kr < 1) {
      g.strokeStyle = `hsla(${b.hue.toFixed(1)}, 100%, 70%, ${(0.8 * strength * (1 - kr)).toFixed(3)})`;
      g.lineWidth = (22 * (1 - kr) + 1) * k;
      g.beginPath();
      g.arc(x, y, (40 + expo(kr) * 900) * k, 0, Math.PI * 2);
      g.stroke();
    }
    // sparks
    const seed = Math.round(b.t * 1000) + bi;
    for (let i = 0; i < b.n; i++) {
      const life = 1 - clamp01(age / (0.9 + hash(i + 31 + seed) * 0.7));
      if (life <= 0) continue;
      const a = hash(i + seed * 97) * Math.PI * 2;
      const sp = 500 + hash(i * 7 + seed) * 1300;
      const d = ((sp * (1 - Math.exp(-age * 2.6))) / 2.6) * k;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d + age * age * 260 * k;
      const tail = 26 * life * k;
      g.strokeStyle = `hsla(${((b.hue + hash(i + 3 + seed) * 120) % 360).toFixed(1)}, 100%, ${(65 + 25 * life).toFixed(1)}%, ${(life * strength).toFixed(3)})`;
      g.lineWidth = (2 + 4 * life) * Math.max(0.6, k);
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px - Math.cos(a) * tail, py - Math.sin(a) * tail);
      g.stroke();
    }
  });
  g.globalCompositeOperation = 'source-over';
}
