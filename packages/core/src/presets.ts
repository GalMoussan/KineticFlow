/**
 * Quick doodles that need no generator: circle, underline, arrow, scribble (highlight), burst, check, star, heart.
 * Each returns a `SketchDoc`. **Bit-exact in Node and Chromium:** only + − × ÷ sqrt, `Math.imul`/`Math.round`; no
 * `Math.sin/cos` (angles come from a unit-circle table built by half-angle steps and complex multiplication). Jitter
 * is an integer hash of (seed, index): the runtime's `hash()` uses `Math.sin` and is page-only, so it cannot be used
 * here.
 */
import type { SketchDoc, SketchMode, SketchPoint, SketchPreset, SketchStroke } from './sketch.ts';

export const PRESET_VERSION = 'preset@1';

/** murmur3 fmix32 of (seed, i) → [0, 1). */
function rnd(seed: number, i: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Jitter in [−amp, amp). */
const jit = (seed: number, i: number, amp: number) => (rnd(seed, i) * 2 - 1) * amp;
/** Smooth jitter: linear between hashed knots every `every` points. */
function smooth(seed: number, i: number, amp: number, every: number): number {
  const k = Math.floor(i / every);
  const f = (i - k * every) / every;
  return jit(seed, k, amp) * (1 - f) + jit(seed, k + 1, amp) * f;
}

/** Unit circle in N = 64 steps of 5.625°, angle 0 at +x, growing clockwise on screen (y down). */
const N = 64;
const CIRCLE: readonly (readonly [number, number])[] = (() => {
  let c = 0; // cos(π/2)
  for (let i = 0; i < 4; i++) c = Math.sqrt((1 + c) / 2); // π/4, π/8, π/16, π/32 = 2π/64
  const s = Math.sqrt(1 - c * c);
  const out: [number, number][] = [];
  let x = 1;
  let y = 0;
  for (let k = 0; k < N; k++) {
    out.push([x, y]);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return out;
})();
const cosAt = (k: number) => CIRCLE[((k % N) + N) % N]![0];
const sinAt = (k: number) => CIRCLE[((k % N) + N) % N]![1];

function pt(x: number, y: number, box: readonly [number, number]): SketchPoint {
  const qx = Math.round(x);
  const qy = Math.round(y);
  return [qx < 0 ? 0 : qx > box[0] ? box[0] : qx, qy < 0 ? 0 : qy > box[1] ? box[1] : qy];
}

/** Drops consecutive duplicate points (quantisation can produce them). */
function dedupe(pts: SketchPoint[]): SketchPoint[] {
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1]);
}

interface Shape {
  box: [number, number];
  strokes: SketchStroke[];
}

function circle(seed: number): Shape {
  const box: [number, number] = [1000, 640];
  const pts: SketchPoint[] = [];
  const start = 36; // ≈ 202°: upper left, the way a hand starts a circle
  const steps = 72; // 1.125 turns: the end overshoots the start
  for (let i = 0; i <= steps; i++) {
    const shrink = 1 - (0.07 * i) / steps;
    const r = shrink * (1 + smooth(seed, i, 0.025, 9));
    pts.push(pt(500 + 470 * r * cosAt(start + i), 320 + 290 * r * sinAt(start + i) + jit(seed, 500 + i, 2), box));
  }
  return { box, strokes: [{ pts: dedupe(pts) }] };
}

function underline(seed: number): Shape {
  const box: [number, number] = [1000, 160];
  const a: SketchPoint[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    a.push(pt(30 + 940 * u, 92 - 40 * u * (1 - u) - 10 * u + smooth(seed, i, 4, 5), box));
  }
  const b: SketchPoint[] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    b.push(pt(930 - 760 * u, 124 - 18 * u * (1 - u) + smooth(seed, 100 + i, 4, 4), box));
  }
  return { box, strokes: [{ pts: dedupe(a) }, { pts: dedupe(b), w: 0.8 }] };
}

function arrow(seed: number): Shape {
  const box: [number, number] = [1000, 420];
  const [x0, y0, cx, cy, x1, y1] = [40, 340, 470, 30 + jit(seed, 1, 20), 920, 210];
  const shaft: SketchPoint[] = [];
  for (let i = 0; i <= 18; i++) {
    const u = i / 18;
    const v = 1 - u;
    shaft.push(pt(v * v * x0 + 2 * u * v * cx + u * u * x1, v * v * y0 + 2 * u * v * cy + u * u * y1 + smooth(seed, 10 + i, 3, 6), box));
  }
  // barbs: the end tangent reversed, turned ±28.1° (table step 5), 125 long
  const dx = cx - x1;
  const dy = cy - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const [ux, uy] = [dx / len, dy / len];
  const [c, s] = [cosAt(5), sinAt(5)];
  const L = 125 + jit(seed, 2, 10);
  const b1 = pt(x1 + L * (ux * c - uy * s), y1 + L * (ux * s + uy * c), box);
  const b2 = pt(x1 + L * (ux * c + uy * s), y1 + L * (-ux * s + uy * c), box);
  return { box, strokes: [{ pts: dedupe(shaft) }, { pts: [b1, pt(x1, y1, box), b2] }] };
}

function scribble(seed: number): Shape {
  const box: [number, number] = [1000, 300];
  const pts: SketchPoint[] = [];
  const zigs = 13;
  for (let i = 0; i <= zigs; i++) {
    const x = 40 + (880 * i) / zigs;
    const top = i % 2 === 1;
    pts.push(pt(x + (top ? 40 : 0) + jit(seed, i, 12), (top ? 45 : 255) + jit(seed, 100 + i, 14), box));
  }
  return { box, strokes: [{ pts }] };
}

function burst(seed: number): Shape {
  const box: [number, number] = [1000, 1000];
  const strokes: SketchStroke[] = [];
  for (let k = 0; k < 16; k++) {
    const a = k * 4 - 16; // start at the top, clockwise
    const r0 = 205 + jit(seed, k, 20);
    const r1 = (k % 2 === 0 ? 470 : 375) + jit(seed, 40 + k, 18);
    strokes.push({ pts: [pt(500 + r0 * cosAt(a), 500 + r0 * sinAt(a), box), pt(500 + r1 * cosAt(a), 500 + r1 * sinAt(a), box)] });
  }
  return { box, strokes };
}

function check(seed: number): Shape {
  const box: [number, number] = [1000, 800];
  const knots: [number, number][] = [[70, 450], [215, 575], [370, 735], [565, 470], [765, 225], [950, 50]];
  const pts = knots.map(([x, y], i) => pt(x + jit(seed, i, 10), y + jit(seed, 20 + i, 10), box));
  return { box, strokes: [{ pts }] };
}

function star(seed: number): Shape {
  const box: [number, number] = [1000, 960];
  const c36 = (1 + Math.sqrt(5)) / 4;
  const s36 = Math.sqrt(1 - c36 * c36);
  const pts: SketchPoint[] = [];
  let [x, y] = [0, -1]; // the top point
  for (let k = 0; k < 10; k++) {
    const r = (k % 2 === 0 ? 470 : 190) + jit(seed, k, 12);
    pts.push(pt(500 + r * x, 510 + r * y, box));
    [x, y] = [x * c36 - y * s36, x * s36 + y * c36];
  }
  return { box, strokes: [{ pts, closed: true }] };
}

function heart(seed: number): Shape {
  const box: [number, number] = [1000, 900];
  const raw: [number, number][] = [];
  for (let k = 0; k < N; k++) {
    const c = cosAt(k);
    const s = sinAt(k);
    const c2 = 2 * c * c - 1;
    const c3 = 4 * c * c * c - 3 * c;
    const c4 = 8 * c * c * c * c - 8 * c * c + 1;
    raw.push([16 * s * s * s, -(13 * c - 5 * c2 - 2 * c3 - c4)]);
  }
  // fit [−16, 16] × [−12.x, 17] into the box with a margin
  let [y0, y1] = [Infinity, -Infinity];
  for (const [, y] of raw) {
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const k = Math.min(940 / 32, 840 / (y1 - y0));
  const pts = raw.map(([x, y], i) => pt(500 + x * k * (1 + smooth(seed, i, 0.02, 8)), 30 + (y - y0) * k, box));
  return { box, strokes: [{ pts: dedupe(pts), closed: true }] };
}

const SHAPES: Record<SketchPreset, (seed: number) => Shape> = { circle, underline, arrow, scribble, burst, check, star, heart };

/**
 * The preset as a `SketchDoc` in `mode`. Line mode joins the strokes in order into one pen path (an arrow becomes
 * shaft → barb → tip → barb, a burst a zigzag). `seed` varies the jitter (use `seedOf(sketch.id)`).
 */
export function presetDoc(preset: SketchPreset, mode: SketchMode, seed: number): SketchDoc {
  const shape = SHAPES[preset](seed >>> 0);
  const strokes: SketchStroke[] =
    mode === 'line' && shape.strokes.length > 1 ? [{ pts: dedupe(shape.strokes.flatMap((s) => s.pts)) }] : shape.strokes;
  return {
    v: 1,
    box: shape.box,
    mode,
    strokes,
    meta: { source: 'preset', prompt: preset, detail: 1, seed: seed >>> 0, version: PRESET_VERSION },
  };
}
