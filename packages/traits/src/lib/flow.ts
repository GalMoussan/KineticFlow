/**
 * The seeded flow field shared by `background/flow-field` (streamlines) and `reveal/flow-drift` (letters riding
 * them): a smooth direction field from two octaves of lattice value noise (`hash`), in screen px of the format, so
 * the letters follow exactly the streamlines drawn behind them. Page-only (hash and trig are not bit-exact in Node).
 */
import { hash } from '@reel/runtime';

export interface Field {
  /** Lattice cell of the coarse octave, px. */
  cell: number;
  /** Mean flow direction, radians (screen: x right, y down). */
  bias: number;
  /** How far the noise turns the flow away from `bias` (radians at noise ±0.5). */
  turn: number;
  seed: number;
}

/** The field of a format: cells scale with its short side; one seed for the whole reel. */
export const fieldOf = (W: number, H: number, seed = 7): Field => ({ cell: 0.46 * Math.min(W, H), bias: -0.62 * Math.PI, turn: 3.4, seed });

const fade = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const h = (i: number, j: number) => hash(i * 127.1 + j * 311.7 + seed * 74.7);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Flow direction (radians) at screen point (x, y). */
export function flowAngle(f: Field, x: number, y: number): number {
  const u = x / f.cell;
  const v = y / f.cell;
  const n = 0.68 * vnoise(u, v, f.seed) + 0.32 * vnoise(2.03 * u + 5.2, 2.03 * v + 1.3, f.seed + 1);
  return f.bias + (n - 0.5) * f.turn;
}

/**
 * Streamline through (x, y): `steps` midpoint steps of `h` px along the field (`dir` −1 = upstream). Returns
 * `[x0, y0, x1, y1, …]` with (x0, y0) = (x, y) exactly.
 */
export function streamline(f: Field, x: number, y: number, steps: number, h: number, dir: 1 | -1): Float64Array {
  const out = new Float64Array(2 * (steps + 1));
  out[0] = x;
  out[1] = y;
  for (let i = 1; i <= steps; i++) {
    const a = flowAngle(f, x, y);
    const mx = x + Math.cos(a) * h * 0.5 * dir;
    const my = y + Math.sin(a) * h * 0.5 * dir;
    const b = flowAngle(f, mx, my);
    x += Math.cos(b) * h * dir;
    y += Math.sin(b) * h * dir;
    out[2 * i] = x;
    out[2 * i + 1] = y;
  }
  return out;
}

/** Point at fractional step `s` (0 … steps) of a streamline, and its heading in radians. */
export function along(line: Float64Array, s: number): { x: number; y: number; a: number } {
  const last = line.length / 2 - 1;
  const c = s <= 0 ? 0 : s >= last ? last : s;
  const i = Math.min(last - 1, Math.floor(c));
  const k = c - i;
  const x0 = line[2 * i]!;
  const y0 = line[2 * i + 1]!;
  const x1 = line[2 * i + 2]!;
  const y1 = line[2 * i + 3]!;
  return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, a: Math.atan2(y1 - y0, x1 - x0) };
}
