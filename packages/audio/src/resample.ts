/**
 * Deterministic sample-rate conversion to the engine rate: a polyphase windowed-sinc (Blackman, 16 zero crossings
 * per side at the lower rate) with exact rational phase tracking. Kernel tables come from `dmath`, so the result is
 * bit-identical in Node and the browser. Passband ≈ 0.9 · min(srIn, srOut)/2; stopband ≥ 70 dB.
 */
import { PI, cosTurns, sin } from './dmath.ts';

const ZEROS = 16;
/** Above this many output phases, kernels are evaluated per output sample instead of tabulated. */
const MAX_TABLE_PHASES = 4096;

const gcd = (a: number, b: number): number => {
  while (b) [a, b] = [b, a % b];
  return a;
};

function sinc(x: number): number {
  return x === 0 ? 1 : sin(PI * x) / (PI * x);
}

/** Resamples one channel from `srIn` to `srOut` (both integers). Output length = round(len · srOut / srIn). */
export function resample(x: Float32Array, srIn: number, srOut: number): Float32Array {
  if (srIn === srOut) return x.slice();
  const g = gcd(srIn, srOut);
  const L = srOut / g; // output phases per M input steps
  const M = srIn / g;
  const outLen = Math.round((x.length * L) / M);
  // Cutoff relative to the input rate's Nyquist; widen the kernel when decimating.
  const fc = Math.min(1, L / M) * 0.9;
  const half = Math.ceil(ZEROS / fc); // taps per side
  const taps = 2 * half;
  const kernel = (phase: number, out: Float64Array) => {
    // Output sample sits at input position n + phase/L; tap k reads input n − half + 1 + k.
    const frac = phase / L;
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const d = k - half + 1 - frac; // distance in input samples
      const u = d / (half + 1); // −1..1 across the window
      const w = u <= -1 || u >= 1 ? 0 : 0.42 + 0.5 * cosTurns(u * 0.5) + 0.08 * cosTurns(u);
      const v = fc * sinc(fc * d) * w;
      out[k] = v;
      sum += v;
    }
    for (let k = 0; k < taps; k++) out[k] = out[k]! / sum; // unity DC gain in every phase
  };
  const table = L <= MAX_TABLE_PHASES ? new Float64Array(L * taps) : null;
  const scratch = new Float64Array(taps);
  if (table) {
    for (let p = 0; p < L; p++) {
      kernel(p, scratch);
      table.set(scratch, p * taps);
    }
  }
  const y = new Float32Array(outLen);
  const last = x.length - 1;
  for (let j = 0; j < outLen; j++) {
    const num = j * M;
    const n = Math.floor(num / L);
    const phase = num - n * L;
    let h: Float64Array;
    let o = 0;
    if (table) {
      h = table;
      o = phase * taps;
    } else {
      kernel(phase, scratch);
      h = scratch;
    }
    let acc = 0;
    const base = n - half + 1;
    for (let k = 0; k < taps; k++) {
      const i = base + k;
      if (i >= 0 && i <= last) acc += x[i]! * h[o + k]!;
    }
    y[j] = acc;
  }
  return y;
}
