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
