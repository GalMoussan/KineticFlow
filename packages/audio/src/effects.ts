/**
 * Time-based effects on whole stereo buffers: tempo delay, Freeverb-style reverb, chorus. Each runs as one pass over
 * a fixed input, sums in a fixed order and uses no transcendental Math in the sample loop.
 */
import { Biquad, onePoleCoef } from './dsp.ts';

export interface DelayOptions {
  /** Delay times in seconds. */
  left: number;
  right: number;
  /** 0..0.95 */
  feedback: number;
  /** Low-pass in the feedback path, Hz. */
  damp: number;
  /** Cross-feed the repeats (ping-pong). */
  pingPong?: boolean;
}

/** Wet-only stereo delay: reads `inL/inR`, adds the repeats into `outL/outR`. */
export function delay(inL: Float64Array, inR: Float64Array, outL: Float64Array, outR: Float64Array, o: DelayOptions, sr: number): void {
  const n = inL.length;
  const dl = Math.max(1, Math.round(o.left * sr));
  const dr = Math.max(1, Math.round(o.right * sr));
  const bl = new Float64Array(dl);
  const br = new Float64Array(dr);
  const a = onePoleCoef(o.damp, sr);
  let zl = 0;
  let zr = 0;
  let il = 0;
  let ir = 0;
  for (let i = 0; i < n; i++) {
    const yl = bl[il]!;
    const yr = br[ir]!;
    zl += a * (yl - zl);
    zr += a * (yr - zr);
    if (o.pingPong) {
      bl[il] = (inL[i]! + inR[i]!) * 0.5 + zr * o.feedback;
      br[ir] = zl * o.feedback;
    } else {
      bl[il] = inL[i]! + zl * o.feedback;
      br[ir] = inR[i]! + zr * o.feedback;
    }
    outL[i]! += yl;
    outR[i]! += yr;
    if (++il === dl) il = 0;
    if (++ir === dr) ir = 0;
  }
}

export interface ReverbOptions {
  /** 0..1 room size (comb feedback 0.7..0.98). */
  size: number;
  /** 0..1 high-frequency damping. */
  damp: number;
  /** 0..1 stereo width. */
  width: number;
  /** Seconds before the first reflection. */
  predelay: number;
  /** Input band-limit, Hz (keeps mud and fizz out of the tail). */
  lowCut: number;
  highCut: number;
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

/** Freeverb (Jezar): 8 parallel damped combs → 4 series allpasses per channel. Wet only, added into `out`. */
export function reverb(inL: Float64Array, inR: Float64Array, outL: Float64Array, outR: Float64Array, o: ReverbOptions, sr: number): void {
  const n = inL.length;
  const scale = sr / 44100;
  const feedback = 0.7 + o.size * 0.28;
  const damp1 = o.damp * 0.4;
  const damp2 = 1 - damp1;
  const wet1 = 0.5 + o.width / 2;
  const wet2 = (1 - o.width) / 2;
  const pre = Math.round(o.predelay * sr);
  const hp = new Biquad('hp', o.lowCut, sr);
  const lp = new Biquad('lp', o.highCut, sr);
  const make = (lens: number[], extra: number) => lens.map((len) => new Float64Array(Math.round((len + extra) * scale)));
  const combs = [make(COMBS, 0), make(COMBS, SPREAD)];
  const aps = [make(ALLPASSES, 0), make(ALLPASSES, SPREAD)];
  const store = [new Float64Array(8), new Float64Array(8)];
  const ci = [new Int32Array(8), new Int32Array(8)];
  const ai = [new Int32Array(4), new Int32Array(4)];
  const outs = [0, 0];
  for (let i = 0; i < n; i++) {
    const j = i - pre;
    const x = j >= 0 ? lp.process(hp.process((inL[j]! + inR[j]!) * 0.015)) : lp.process(hp.process(0));
    for (let ch = 0; ch < 2; ch++) {
      const cb = combs[ch]!;
      const st = store[ch]!;
      const idx = ci[ch]!;
      let acc = 0;
      for (let c = 0; c < 8; c++) {
        const buf = cb[c]!;
        const k = idx[c]!;
        const y = buf[k]!;
        const f = y * damp2 + st[c]! * damp1;
        st[c] = f;
        buf[k] = x + f * feedback;
        idx[c] = k + 1 === buf.length ? 0 : k + 1;
        acc += y;
      }
      const ab = aps[ch]!;
      const aidx = ai[ch]!;
      for (let c = 0; c < 4; c++) {
        const buf = ab[c]!;
        const k = aidx[c]!;
        const b = buf[k]!;
        buf[k] = acc + b * 0.5;
        acc = b - acc;
        aidx[c] = k + 1 === buf.length ? 0 : k + 1;
      }
      outs[ch] = acc;
    }
    outL[i]! += outs[0]! * wet1 + outs[1]! * wet2;
    outR[i]! += outs[1]! * wet1 + outs[0]! * wet2;
  }
}

export interface ChorusOptions {
  /** LFO rate, Hz. */
  rate: number;
  /** Modulation depth, seconds. */
  depth: number;
  /** Centre delay, seconds. */
  delay: number;
  /** 0..1 wet share. */
  mix: number;
}

/** Stereo chorus in place: one modulated tap per channel, triangle LFOs a quarter cycle apart. */
export function chorus(l: Float64Array, r: Float64Array, o: ChorusOptions, sr: number): void {
  const n = l.length;
  const size = Math.ceil((o.delay + o.depth) * sr) + 4;
  const bufs = [new Float64Array(size), new Float64Array(size)];
  const chans = [l, r];
  const step = o.rate / sr;
  const centre = o.delay * sr;
  const depth = o.depth * sr;
  let w = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const x = chans[ch]!;
      const buf = bufs[ch]!;
      buf[w] = x[i]!;
      let p = phase + ch * 0.25;
      p -= Math.floor(p);
      const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; // −1..1
      const d = centre + depth * tri;
      const di = Math.floor(d);
      const frac = d - di;
      let k0 = w - di;
      if (k0 < 0) k0 += size;
      let k1 = k0 - 1;
      if (k1 < 0) k1 += size;
      const y = buf[k0]! + (buf[k1]! - buf[k0]!) * frac;
      x[i] = x[i]! * (1 - o.mix) + y * o.mix;
    }
    if (++w === size) w = 0;
    phase += step;
    if (phase >= 1) phase -= 1;
  }
}
