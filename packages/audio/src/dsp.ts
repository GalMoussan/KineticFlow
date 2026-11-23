/**
 * DSP building blocks: filters, smoothers, envelopes, panning and saturation. Coefficients use `dmath`; the sample
 * loops use + − × ÷ only, so every block is bit-identical in Node and the browser.
 */
import { PI, cos, cosTurns, dbToGain, exp, log, sin, sinTurns, tan, tanh } from './dmath.ts';

// ─── Filters ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Topology-preserving-transform state-variable filter (Zavalishin / Simper). Stable under fast cutoff modulation, so
 * synth voices sweep it per block. One instance filters one channel.
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  lp = 0;
  bp = 0;
  hp = 0;
  private readonly sr: number;

  constructor(sr: number, cutoff = 1000, q = 0.707) {
    this.sr = sr;
    this.set(cutoff, q);
  }

  /** Cutoff in Hz (clamped below Nyquist), resonance Q (0.5 = no peak). */
  set(cutoff: number, q: number): void {
    const fc = cutoff < 10 ? 10 : cutoff > this.sr * 0.49 ? this.sr * 0.49 : cutoff;
    const g = tan((PI * fc) / this.sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  /** Runs one sample; returns the low-pass output and updates `lp`, `bp`, `hp`. */
  process(v0: number): number {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

export type BiquadType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak' | 'lowshelf' | 'highshelf';

/** RBJ-cookbook biquad in transposed direct form II. One instance filters one channel. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(type: BiquadType, freq: number, sr: number, q = 0.707, gainDb = 0) {
    const f = freq > sr * 0.49 ? sr * 0.49 : freq;
    const w = (2 * PI * f) / sr;
    const cw = cos(w);
    const sw = sin(w);
    const A = dbToGain(gainDb / 2);
    let alpha = sw / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lp':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'hp':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bp': // constant 0 dB peak gain
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1;
        b1 = -2 * cw;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      default: {
        // Shelves with slope S = 1 (q is ignored).
        alpha = (sw / 2) * Math.SQRT2;
        const sa = 2 * Math.sqrt(A) * alpha;
        const s = type === 'lowshelf' ? 1 : -1;
        b0 = A * (A + 1 - s * (A - 1) * cw + sa);
        b1 = s * 2 * A * (A - 1 - s * (A + 1) * cw);
        b2 = A * (A + 1 - s * (A - 1) * cw - sa);
        a0 = A + 1 + s * (A - 1) * cw + sa;
        a1 = -s * 2 * (A - 1 + s * (A + 1) * cw);
        a2 = A + 1 + s * (A - 1) * cw - sa;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** Filters `buf[from, to)` in place. */
  run(buf: Float64Array, from = 0, to = buf.length): void {
    for (let i = from; i < to; i++) buf[i] = this.process(buf[i]!);
  }
}

/** One-pole low-pass smoother: y += a·(x − y), with `a` set from a time constant. */
export class OnePole {
  y = 0;
  private a: number;
  constructor(seconds: number, sr: number, initial = 0) {
    this.a = seconds <= 0 ? 1 : 1 - exp(-1 / (seconds * sr));
    this.y = initial;
  }
  process(x: number): number {
    return (this.y += this.a * (x - this.y));
  }
}

/** Per-sample coefficient of a one-pole low-pass at `hz` (for inline loops). */
export function onePoleCoef(hz: number, sr: number): number {
  return 1 - exp((-2 * PI * hz) / sr);
}

/** Multiplier per sample that decays by 60 dB over `seconds`. */
export function decayCoef(seconds: number, sr: number): number {
  return seconds <= 0 ? 0 : exp(-6.907755278982137 / (seconds * sr));
}

// ─── Envelopes ──────────────────────────────────────────────────────────────────────────────────────────────

export interface AdsrShape {
  /** Linear rise, seconds. */
  a: number;
  /** Exponential fall to `s` (60 dB time constant), seconds. */
  d: number;
  /** Sustain level 0..1. */
  s: number;
  /** Exponential release after the gate (60 dB), seconds; the voice ends there. */
  r: number;
}

/**
 * ADSR generator. `gate` is the number of samples the key is held; after `gate + r·sr` samples the level is 0.
 * Release starts from the level reached at the gate, so short notes never click.
 */
export class Adsr {
  private i = 0;
  private level = 0;
  private readonly aLen: number;
  private readonly dCoef: number;
  private readonly rCoef: number;
  readonly length: number;
  private readonly gate: number;
  private readonly rLen: number;
  private readonly s: number;

  constructor(shape: AdsrShape, gateSamples: number, sr: number) {
    this.aLen = Math.max(1, Math.round(shape.a * sr));
    this.dCoef = decayCoef(shape.d, sr);
    this.rCoef = decayCoef(shape.r, sr);
    this.rLen = Math.max(1, Math.round(shape.r * sr));
    this.gate = Math.max(1, gateSamples);
    this.length = this.gate + this.rLen;
    this.s = shape.s;
  }

  next(): number {
    const i = this.i++;
    if (i < this.gate) {
      if (i < this.aLen) this.level = (i + 1) / this.aLen;
      else this.level = this.s + (this.level - this.s) * this.dCoef;
    } else if (i < this.length) {
      // Exponential release, blended into a linear ramp so it reaches exactly 0 at the end.
      const left = (this.length - i) / this.rLen;
      this.level *= this.rCoef;
      return this.level * left;
    } else return 0;
    return this.level;
  }
}

// ─── Panning and saturation ─────────────────────────────────────────────────────────────────────────────────

/** Equal-power pan gains for `pan` in −1 (left) … 1 (right): [left, right], each 1/√2 at centre. */
export function panGains(pan: number): [number, number] {
  const p = pan < -1 ? -1 : pan > 1 ? 1 : pan;
  const turns = (p + 1) / 8; // (p + 1)·π/4 radians
  return [cosTurns(turns), sinTurns(turns)];
}

/** Cubic soft clip: 1.5x − 0.5x³ on [−1, 1] (slope 1.5 at 0, flat at ±1), hard ±1 beyond. */
export function softClip(x: number): number {
  if (x <= -1) return -1;
  if (x >= 1) return 1;
  return 1.5 * x - 0.5 * x * x * x;
}

/** tanh saturation with `drive` (≥ 1), gain-compensated so small signals keep their level. */
export function saturate(x: number, drive: number): number {
  return tanh(x * drive) / drive;
}

/** Linear-in-dB interpolation between two frequencies for sweeps: f0·(f1/f0)^u. */
export function expInterp(f0: number, f1: number, u: number): number {
  return f0 * exp(u * log(f1 / f0));
}
