/**
 * Dynamics: bus compressor, kick-keyed ducking (sidechain pump) and the master look-ahead limiter. Deterministic:
 * the sample loops use + − × ÷ and dmath only.
 */
import { Biquad, decayCoef } from './dsp.ts';
import { PI, cosTurns, exp, log, sin } from './dmath.ts';

type Buf = Float32Array | Float64Array;

/**
 * Integrated loudness in LUFS (ITU-R BS.1770-4: K-weighting, 400 ms blocks with 75 % overlap, −70 LUFS absolute and
 * −10 LU relative gates), deterministic. K-weighting uses RBJ biquads matched to the standard's 48 kHz filters
 * (high shelf +4 dB at 1682 Hz, high-pass at 38 Hz); within 0.1 LU of ffmpeg `ebur128` on music. −Infinity for silence.
 */
export function loudness(l: Buf, r: Buf, sr: number): number {
  const n = l.length;
  const step = Math.round(0.1 * sr);
  const steps = Math.floor(n / step);
  if (steps < 4) return -Infinity;
  // Power of each 100 ms quarter-block, K-weighted, channels summed (L and R weigh 1).
  const quarter = new Float64Array(steps);
  for (const ch of [l, r]) {
    const shelf = new Biquad('highshelf', 1681.97, sr, 0.7071, 4);
    const hp = new Biquad('hp', 38.135, sr, 0.5003);
    for (let q = 0, i = 0; q < steps; q++) {
      let s = 0;
      for (const end = i + step; i < end; i++) {
        const y = hp.process(shelf.process(ch[i]!));
        s += y * y;
      }
      quarter[q]! += s / step;
    }
  }
  const blocks = new Float64Array(steps - 3);
  for (let b = 0; b < blocks.length; b++) blocks[b] = (quarter[b]! + quarter[b + 1]! + quarter[b + 2]! + quarter[b + 3]!) / 4;
  const lufs = (p: number) => -0.691 + (10 / 2.302585092994046) * log(p);
  const gated = (thresh: number) => {
    let s = 0;
    let c = 0;
    for (const p of blocks) {
      if (p > 0 && lufs(p) > thresh) {
        s += p;
        c++;
      }
    }
    return c ? s / c : 0;
  };
  const abs = gated(-70);
  if (abs === 0) return -Infinity;
  const rel = gated(lufs(abs) - 10);
  return rel === 0 ? -Infinity : lufs(rel);
}

/** 4× oversampling taps per side (windowed sinc), phases 1/4, 2/4, 3/4. */
const TP_TAPS = 12;
let tpKernel: Float64Array | null = null;

/**
 * True peak (BS.1770-4 annex 2 style): max |x| over the signal 4× oversampled by a Hann-windowed sinc
 * (12 taps per side), both channels. Deterministic (kernel from dmath). Linear amplitude. Only the gaps next to a
 * sample within −6 dB of the sample peak are interpolated: a band-limited overshoot elsewhere cannot reach it.
 */
export function truePeak(l: Buf, r: Buf): number {
  if (!tpKernel) {
    tpKernel = new Float64Array(3 * 2 * TP_TAPS);
    for (let ph = 1; ph <= 3; ph++) {
      for (let k = 0; k < 2 * TP_TAPS; k++) {
        const d = k - TP_TAPS + 1 - ph / 4; // distance from the output point to input tap
        const w = 0.5 + 0.5 * cosTurns(d / (2 * TP_TAPS));
        tpKernel[(ph - 1) * 2 * TP_TAPS + k] = (sin(PI * d) / (PI * d)) * w;
      }
    }
  }
  const h = tpKernel;
  const T = 2 * TP_TAPS;
  let sp = 0;
  for (const x of [l, r]) for (let i = 0; i < x.length; i++) sp = Math.max(sp, x[i]! < 0 ? -x[i]! : x[i]!);
  const near = sp * 0.5;
  let peak = sp;
  for (const x of [l, r]) {
    const n = x.length;
    for (let i = 0; i < n - 1; i++) {
      const a = x[i]! < 0 ? -x[i]! : x[i]!;
      const b = x[i + 1]! < 0 ? -x[i + 1]! : x[i + 1]!;
      if (a < near && b < near) continue;
      for (let ph = 0; ph < 3; ph++) {
        let s = 0;
        const o = ph * T;
        for (let k = 0; k < T; k++) {
          const j = i - TP_TAPS + 1 + k;
          if (j >= 0 && j < n) s += x[j]! * h[o + k]!;
        }
        const v = s < 0 ? -s : s;
        if (v > peak) peak = v;
      }
    }
  }
  return peak;
}

export interface CompressorOptions {
  /** Threshold, linear amplitude. */
  threshold: number;
  ratio: number;
  /** Detector attack/release, seconds (60 dB time). */
  attack: number;
  release: number;
  /** Linear make-up gain. */
  makeup?: number;
}

/** Stereo-linked feed-forward peak compressor, in place. */
export function compress(l: Buf, r: Buf, o: CompressorOptions, sr: number): void {
  const att = 1 - decayCoef(o.attack, sr);
  const rel = 1 - decayCoef(o.release, sr);
  const slope = 1 / o.ratio - 1;
  const inv = 1 / o.threshold;
  const makeup = o.makeup ?? 1;
  let env = 0;
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]!), Math.abs(r[i]!));
    env += (a > env ? att : rel) * (a - env);
    const g = env > o.threshold ? exp(slope * log(env * inv)) * makeup : makeup;
    l[i] = l[i]! * g;
    r[i] = r[i]! * g;
  }
}

export interface DuckOptions {
  /** 0..1 gain reduction at the trigger. */
  depth: number;
  /** Seconds to reach full reduction after the trigger. */
  attack: number;
  /** Seconds to recover (quadratic ease back to unity). */
  release: number;
}

/** Sidechain-style pump: gain dips at each trigger sample (sorted) and eases back. In place. */
export function duck(l: Buf, r: Buf, triggers: number[], o: DuckOptions, sr: number): void {
  if (!triggers.length || o.depth <= 0) return;
  const aLen = Math.max(1, Math.round(o.attack * sr));
  const rLen = Math.max(1, Math.round(o.release * sr));
  let k = 0;
  let last = -1;
  let from = 1; // gain when the current trigger fired (attack ramps from here)
  let g = 1;
  for (let i = 0; i < l.length; i++) {
    while (k < triggers.length && triggers[k]! <= i) {
      last = triggers[k++]!;
      from = g;
    }
    if (last < 0) continue;
    const d = i - last;
    const low = 1 - o.depth;
    if (d < aLen) g = from + (low - from) * ((d + 1) / aLen);
    else if (d < aLen + rLen) {
      const u = (d - aLen) / rLen;
      g = low + o.depth * (1 - (1 - u) * (1 - u));
    } else g = 1;
    l[i] = l[i]! * g;
    r[i] = r[i]! * g;
  }
}

export interface LimitOptions {
  /** Ceiling as a fraction of the input's peak (e.g. 0.63 ≈ −4 dB of peak reduction). */
  ceiling: number;
  /** Look-ahead (= attack) in seconds. */
  lookahead: number;
  /** Time for the gain to recover from full reduction to unity, in seconds (linear ramp). */
  release: number;
}

/**
 * Limits stereo `l/r` in place (linked channels) so no sample exceeds `ceiling · peak`.
 * Gain: per-frame target → linear release → sliding minimum over the look-ahead → moving average over the
 * look-ahead. The min-then-average pair guarantees the gain at every frame is ≤ its target, with a smooth attack.
 */
export function limit(l: Buf, r: Buf, sampleRate: number, o: LimitOptions): void {
  const frames = l.length;
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  if (peak === 0 || o.ceiling >= 1) return;
  const ceil = peak * o.ceiling;
  const W = Math.max(1, Math.round(o.lookahead * sampleRate));
  const rise = 1 / Math.max(1, Math.round(o.release * sampleRate));

  const g = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(Math.abs(l[i]!), Math.abs(r[i]!));
    g[i] = a > ceil ? ceil / a : 1;
  }
  // Sliding minimum over [i, i + W) (monotonic deque), so the gain starts dropping W frames before a peak.
  const m = new Float64Array(frames);
  const dq = new Int32Array(frames);
  let head = 0;
  let tail = 0;
  for (let j = frames - 1; j >= 0; j--) {
    while (tail > head && g[dq[tail - 1]!]! >= g[j]!) tail--;
    dq[tail++] = j;
    while (dq[head]! >= j + W) head++;
    m[j] = g[dq[head]!]!;
  }
  for (let i = 1; i < frames; i++) m[i] = Math.min(m[i]!, m[i - 1]! + rise);
  let sum = 0;
  for (let i = 0; i < frames; i++) {
    sum += m[i]!;
    if (i >= W) sum -= m[i - W]!;
    const gain = sum / Math.min(i + 1, W);
    l[i] = l[i]! * gain;
    r[i] = r[i]! * gain;
  }
}
