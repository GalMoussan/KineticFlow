/**
 * Per-frame band envelopes (PLAN.md §7, M3): what `rhythm: audio-reactive` follows. The same algorithm runs on
 * generated music and on the user's own track, in Node and in the browser preview, bit-identically: only
 * `+ − × ÷ sqrt floor round` and `dmath` (no `Math.sin/cos/exp/log/pow`), fixed summation order, float64.
 *
 * - **Spectra.** Mono mix `(l + r) / 2`, periodic Hann window, radix-2 FFT (N = 2048: 23.4 Hz bins at 48 kHz, so the
 *   sub band gets bins 1–2). Two hops share one complex FFT (real/imaginary packing).
 * - **No look-ahead.** Frame i covers video time `[i/fps, (i+1)/fps)`. Its H hops (H ≈ samples-per-frame / 256) are
 *   STFT windows whose **end** lies inside that span, the last one ending exactly at `(i+1)/fps`. A frame never sees
 *   audio after its own window, so a kick at t first shows in frame `floor(t·fps)`.
 * - **Bands** (bin centre f): sub 0 < f < 60 Hz, bass 60–250, mid 250–2000, high ≥ 2000. Per frame: mean band power
 *   over its hops, compressed as `(p / ref)^¼` (Stevens' loudness exponent ≈ 0.25–0.3 of power), clipped to 0..1.
 *   `ref` = the 95th percentile of the band's frame powers over the **whole stem**, floored at −30 dB under the
 *   full-band level (a band the mix barely uses stays low instead of being amplified to full scale).
 * - **Onset.** Half-wave-rectified spectral flux of `|X|^½`, minus a causal 0.4 s moving average of itself; per frame
 *   the max over its hops, divided by the stem's 98th percentile, clipped to 0..1.
 * - Statistics come from every frame of `x` (also beyond `frames`), so they do not depend on how many frames are
 *   requested. Values are rounded to 1e-4 (compact, stable JSON in `REEL` and fingerprints).
 */
import type { Band } from '@reel/core';
import { cosTurns, sinTurns } from './dmath.ts';
import type { Stereo } from './types.ts';

const N = 2048;
const HALF = N / 2;
const TARGET_HOP = 256;
const BAND_REF = 0.95;
const ONSET_REF = 0.98;
/** A band's reference never drops below the full-band reference × this (−30 dB). */
const BAND_FLOOR = 1e-3;
const BASELINE_S = 0.4;

const BANDS4 = ['sub', 'bass', 'mid', 'high'] as const;

/** Twiddles, bit reversal and the Hann window for size N (built once, from dmath). */
let tables: { twr: Float64Array; twi: Float64Array; rev: Uint32Array; hann: Float64Array } | null = null;
function fftTables() {
  if (tables) return tables;
  const twr = new Float64Array(HALF);
  const twi = new Float64Array(HALF);
  for (let k = 0; k < HALF; k++) {
    twr[k] = cosTurns(k / N);
    twi[k] = -sinTurns(k / N);
  }
  const bits = 11; // log2(N)
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const hann = new Float64Array(N);
  for (let n = 0; n < N; n++) hann[n] = 0.5 - 0.5 * twr[n % HALF]! * (n < HALF ? 1 : -1);
  tables = { twr, twi, rev, hann };
  return tables;
}

/** In-place iterative radix-2 complex FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const { twr, twi, rev } = fftTables();
  for (let i = 0; i < N; i++) {
    const j = rev[i]!;
    if (j > i) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = twr[k * step]!;
        const wi = twi[k * step]!;
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/** Value at quantile q (no interpolation) of `v`. */
function quantile(v: Float64Array, q: number): number {
  if (!v.length) return 0;
  const s = Float64Array.from(v).sort();
  return s[Math.floor(q * (s.length - 1))]!;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Per video frame band energies of `x`, 0..1: `sub bass mid high` (compressed band power) and `onset` (spectral
 * flux). Arrays have exactly `frames` entries; frames past the end of `x` are 0. Deterministic.
 */
export function computeEnvelopes(x: Stereo, fps: number, frames: number): Record<Band, number[]> {
  const sr = x.sampleRate;
  const len = Math.min(x.l.length, x.r.length);
  const stemFrames = Math.ceil((len * fps) / sr);
  const F = Math.max(frames, stemFrames);
  const H = Math.max(1, Math.round(sr / fps / TARGET_HOP));
  const mono = new Float64Array(len);
  for (let i = 0; i < len; i++) mono[i] = (x.l[i]! + x.r[i]!) * 0.5;

  // band bins (by bin centre frequency)
  const bandOf = new Int8Array(HALF + 1).fill(-1);
  for (let k = 1; k <= HALF; k++) {
    const f = (k * sr) / N;
    bandOf[k] = f < 60 ? 0 : f < 250 ? 1 : f < 2000 ? 2 : 3;
  }

  const { hann } = fftTables();
  const hops = F * H;
  /** Hop window ends in samples, ascending; the last hop of frame i ends at round((i+1)·sr/fps). */
  const endOf = (h: number) => {
    const i = Math.floor(h / H);
    const j = h - i * H;
    return Math.round((((i + 1) * H - (H - 1 - j)) * sr) / (fps * H));
  };
  const bandHop = new Float64Array(hops * 4);
  const fluxHop = new Float64Array(hops);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let prev = new Float64Array(HALF + 1);
  let cur = new Float64Array(HALF + 1);
  const pa = new Float64Array(HALF + 1);
  const pb = new Float64Array(HALF + 1);
  const fill = (buf: Float64Array, end: number) => {
    const s0 = end - N;
    for (let n = 0; n < N; n++) {
      const s = s0 + n;
      buf[n] = s >= 0 && s < len ? mono[s]! * hann[n]! : 0;
    }
  };
  /** Band sums and flux of one hop's power spectrum `p`. */
  const consume = (h: number, p: Float64Array) => {
    const o = h * 4;
    let flux = 0;
    for (let k = 1; k <= HALF; k++) {
      const pk = p[k]!;
      const bi = o + bandOf[k]!;
      bandHop[bi] = bandHop[bi]! + pk;
      const c = Math.sqrt(Math.sqrt(pk));
      cur[k] = c;
      const d = c - prev[k]!;
      if (d > 0) flux += d;
    }
    fluxHop[h] = flux;
    const t = prev;
    prev = cur;
    cur = t;
  };
  for (let h = 0; h < hops; h += 2) {
    const two = h + 1 < hops;
    fill(re, endOf(h));
    if (two) fill(im, endOf(h + 1));
    else im.fill(0);
    fft(re, im);
    for (let k = 0; k <= HALF; k++) {
      const nk = (N - k) % N;
      const ar = (re[k]! + re[nk]!) * 0.5;
      const ai = (im[k]! - im[nk]!) * 0.5;
      const br = (im[k]! + im[nk]!) * 0.5;
      const bi = (re[nk]! - re[k]!) * 0.5;
      pa[k] = ar * ar + ai * ai;
      pb[k] = br * br + bi * bi;
    }
    consume(h, pa);
    if (two) consume(h + 1, pb);
  }

  // per frame: mean band power over its hops; onset = max over its hops of flux minus its causal moving average
  const band = BANDS4.map(() => new Float64Array(F));
  const total = new Float64Array(F);
  for (let i = 0; i < F; i++) {
    for (let b = 0; b < 4; b++) {
      let s = 0;
      for (let j = 0; j < H; j++) s += bandHop[(i * H + j) * 4 + b]!;
      band[b]![i] = s / H;
      total[i] = total[i]! + s / H;
    }
  }
  const B = Math.max(1, Math.round(BASELINE_S * fps * H));
  const onset = new Float64Array(F);
  let run = 0;
  for (let h = 0; h < hops; h++) {
    const base = run / B;
    const v = fluxHop[h]! - base;
    const i = Math.floor(h / H);
    if (v > onset[i]!) onset[i] = v;
    run += fluxHop[h]!;
    if (h >= B) run -= fluxHop[h - B]!;
  }

  const stem = (a: Float64Array) => a.subarray(0, stemFrames);
  const out = {} as Record<Band, number[]>;
  const totalRef = quantile(stem(total), BAND_REF);
  BANDS4.forEach((name, b) => {
    const ref = Math.max(quantile(stem(band[b]!), BAND_REF), totalRef * BAND_FLOOR);
    const a = band[b]!;
    out[name] = Array.from({ length: frames }, (_, i) => {
      if (!(ref > 0)) return 0;
      const v = Math.sqrt(Math.sqrt(a[i]! / ref));
      return round4(v > 1 ? 1 : v);
    });
  });
  const oref = quantile(stem(onset), ONSET_REF);
  out.onset = Array.from({ length: frames }, (_, i) => {
    if (!(oref > 0)) return 0;
    const v = onset[i]! / oref;
    return round4(v > 1 ? 1 : v);
  });
  return out;
}
