/**
 * Per-frame maths for pages. Page-only: `Math.sin/cos/exp/log/pow` differ bitwise between Node and Chromium
 * (PLAN.md §7.6), so eased values are computed in the browser and never precomputed in Node.
 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Smoothstep. */
export const smooth = (k: number): number => k * k * (3 - 2 * k);

/** Exponential ease-out; exactly 1 at k ≥ 1. */
export const expo = (k: number): number => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));

/** Back ease-out with overshoot `c`. */
export const backOut = (k: number, c = 1.6): number => 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);

/** Cubic ease-in-out. */
export const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Quartic ease-out. */
export const quart = (k: number): number => 1 - Math.pow(1 - clamp01(k), 4);

/**
 * Deterministic hash noise in [0, 1). Page-only: it uses `Math.sin`, whose bits differ between Node and Chromium,
 * so the same `n` gives the same value in every Chromium frame but not in Node.
 */
export const hash = (n: number): number => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** A unit's 2D linear map as channel values: `rotate(rot) skewX(skx) scale(sx, sy)` (degrees). */
export interface Affine {
  rot: number;
  skx: number;
  sx: number;
  sy: number;
}

const DEG = 180 / Math.PI;

/**
 * Decomposes the CSS `matrix(a, b, c, d, …)` linear part, i.e. (x, y) → (a·x + c·y, b·x + d·y), into
 * rotate → skewX → scale, the order the host commits `rot`, `skx`, `sx`/`sy`. Planar faces under parallel projection
 * (isometric blocks, orthographic orbits, card flips) are exactly such maps. An edge-on map (no area) returns
 * `sy = 0`, which the host treats as hidden.
 */
export function affine(a: number, b: number, c: number, d: number): Affine {
  const sx = Math.hypot(a, b);
  if (sx < 1e-9) return { rot: 0, skx: 0, sx: 0, sy: 0 };
  const cos = a / sx;
  const sin = b / sx;
  const sy = -sin * c + cos * d;
  if (Math.abs(sy) < 1e-6) return { rot: Math.atan2(b, a) * DEG, skx: 0, sx, sy: 0 };
  return { rot: Math.atan2(b, a) * DEG, skx: Math.atan((cos * c + sin * d) / sy) * DEG, sx, sy };
}
