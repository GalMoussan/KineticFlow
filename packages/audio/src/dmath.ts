/**
 * Deterministic math for every audio code path (PLAN.md §7 numeric rule). `Math.sin/cos/exp/log/pow/tanh` are not
 * bit-identical between Node and Chromium builds; IEEE-754 `+ − × ÷`, `sqrt`, `floor` and exact bit inspection are.
 * Every function here is built from those only: Cody–Waite range reduction + the fdlibm minimax polynomials, so a
 * render hashes identically wherever it runs.
 *
 * Measured max error vs the host `Math.*` (dmath.test.ts asserts each with ~2× headroom):
 * - `sin`, `cos`: 1.1e-16 absolute on [−2π, 2π] and on [−1e5, 1e5]; range reduction is exact for |x| < 1.6e6 and
 *   degrades gracefully beyond (4.7e-8 at 1e9), still deterministic. Engine oscillators keep phase wrapped.
 * - `sinTurns(p)` = sin(2πp): 2.5e-15 absolute vs `Math.sin(2π·p)` on [−3, 3] (that difference is the rounding of 2πp).
 * - `tan`: 3.3e-16 relative on [−1.5, 1.5].
 * - `exp`: 2.0e-16 relative on [−745, 709].
 * - `log`: 2.2e-16 relative on [1e-300, 1e300].
 * - `pow` (x > 0) = exp(y·log x): 2.9e-15 relative for 2^y, y ∈ [−40, 40]; `exp2` 2.2e-16, `mtof` 2.6e-16.
 * - `tanh`: 2.2e-16 absolute on [−30, 30]; `dbToGain` 2.9e-15 relative on [−120, 24] dB.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const LN2 = 0.6931471805599453;
export const LN10 = 2.302585092994046;

// π/2 split into three parts (fdlibm): k·PIO2_1 is exact for |k| < 2^20.
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624879595063154e-21;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4] with tail `y` (fdlibm __kernel_sin). */
function ksin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos on [−π/4, π/4] with tail `y` (fdlibm __kernel_cos). */
function kcos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + (z * r - x * y));
}

// Range reduction output (avoids an allocation per call).
let redHi = 0;
let redLo = 0;

/** x = n·π/2 + (redHi + redLo), |redHi| ≤ π/4 (+ε); returns n mod 4. Accurate for |x| ≲ 1e9. */
function reduce(x: number): number {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  // Three-term Cody–Waite: each product is exact or carries only its own rounding.
  const r1 = x - n * PIO2_1;
  const w1 = n * PIO2_2;
  const r2 = r1 - w1;
  const tail = r1 - r2 - w1; // rounding of r1 − w1
  const w2 = n * PIO2_3;
  const hi = r2 - w2;
  redHi = hi;
  redLo = r2 - hi - w2 + tail;
  return ((n % 4) + 4) % 4;
}

export function sin(x: number): number {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return ksin(x, 0);
  if (!(x - x === 0)) return NaN;
  switch (reduce(x)) {
    case 0:
      return ksin(redHi, redLo);
    case 1:
      return kcos(redHi, redLo);
    case 2:
      return -ksin(redHi, redLo);
    default:
      return -kcos(redHi, redLo);
  }
}

export function cos(x: number): number {
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kcos(x, 0);
  if (!(x - x === 0)) return NaN;
  switch (reduce(x)) {
    case 0:
      return kcos(redHi, redLo);
    case 1:
      return -ksin(redHi, redLo);
    case 2:
      return -kcos(redHi, redLo);
    default:
      return ksin(redHi, redLo);
  }
}

/** sin(x)/cos(x) from one reduction. */
export function tan(x: number): number {
  if (!(x - x === 0)) return NaN;
  const q = reduce(x);
  const s = ksin(redHi, redLo);
  const c = kcos(redHi, redLo);
  return q & 1 ? -c / s : s / c;
}

/**
 * sin(2π·p) for a phase `p` in turns (oscillators keep phase in [0, 1)). The quadrant split `p − n/4` is exact, so
 * this is cheaper than `sin` and as accurate (≤ 2.3e-16 absolute).
 */
export function sinTurns(p: number): number {
  const n = Math.floor(p * 4 + 0.5);
  const r = (p - n * 0.25) * TAU;
  switch (n & 3) {
    case 0:
      return ksin(r, 0);
    case 1:
      return kcos(r, 0);
    case 2:
      return -ksin(r, 0);
    default:
      return -kcos(r, 0);
  }
}

/** cos(2π·p) for a phase in turns. */
export function cosTurns(p: number): number {
  return sinTurns(p + 0.25);
}

// ln 2 split (fdlibm): k·LN2_HI is exact for |k| ≤ 2^11.
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e0;

const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** 2^k for integer k in [−1074, 1023], built by exact doubling/halving. */
const POW2 = (() => {
  const t = new Float64Array(1074 + 1024);
  t[1074] = 1;
  for (let k = 1; k <= 1023; k++) t[1074 + k] = t[1074 + k - 1]! * 2;
  for (let k = 1; k <= 1074; k++) t[1074 - k] = t[1074 - k + 1]! * 0.5;
  return t;
})();

/** 2^k exactly (0 / Infinity outside the double range). */
export function ldexp1(k: number): number {
  if (k > 1023) return Infinity;
  if (k < -1074) return 0;
  return POW2[k + 1074]!;
}

export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (x > -3.725290298461914e-9 && x < 3.725290298461914e-9) return 1 + x;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  // Split the scale so neither factor overflows or loses the subnormal range early.
  if (k > 1000) return y * ldexp1(k - 1000) * ldexp1(1000);
  if (k < -1000) return y * ldexp1(k + 1000) * ldexp1(-1000);
  return y * ldexp1(k);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const SQRT2 = 1.4142135623730951;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
/** Index of the high word (little-endian hosts store it second). */
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;

/** Natural log. Exact bit-level exponent extraction, then the fdlibm polynomial on m ∈ [√2/2, √2). */
export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54: lift subnormals
    k = -54;
  }
  f64[0] = x;
  const hx = u32[HI]!;
  k += ((hx >>> 20) & 0x7ff) - 1023;
  u32[HI] = (hx & 0x000fffff) | 0x3ff00000; // mantissa as m ∈ [1, 2)
  let m = f64[0]!;
  if (m >= SQRT2) {
    m *= 0.5;
    k += 1;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}

/** x^y. x > 0: exp(y·log x); x = 0 → 0 (y > 0), 1 (y = 0), ∞ (y < 0); x < 0 only for integer y. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x > 0) return exp(y * log(x));
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (Math.floor(y) !== y) return NaN;
  const r = exp(y * log(-x));
  return Math.floor(y * 0.5) * 2 === y ? r : -r;
}

/** 2^x. */
export function exp2(x: number): number {
  const k = Math.floor(x);
  if (k === x) return ldexp1(k);
  return exp((x - k) * LN2) * ldexp1(k);
}

/** Frequency in Hz of a (fractional) MIDI note; A4 = 69 = 440 Hz. */
export function mtof(midi: number): number {
  return 440 * exp2((midi - 69) / 12);
}

export function tanh(x: number): number {
  if (x !== x) return NaN;
  const a = x < 0 ? -x : x;
  if (a > 22) return x < 0 ? -1 : 1;
  if (a < 1e-8) return x;
  const e = exp(-2 * a);
  const t = (1 - e) / (1 + e);
  return x < 0 ? -t : t;
}

/** Decibels → linear amplitude. */
export function dbToGain(db: number): number {
  return exp(db * (LN10 / 20));
}

/** Linear amplitude → decibels (−Infinity for 0). */
export function gainToDb(g: number): number {
  return log(g) * (20 / LN10);
}
