/**
 * Instruments. Each voice renders one event into a stereo Float64 bus starting at an exact sample, mixing with
 * equal-power pan. Voices never write before their start sample, so cue-locked hits land sample-accurately.
 *
 * - `epiano`  2-operator FM electric piano; velocity drives the modulation index (brightness).
 * - `pluck`   Karplus–Strong string with an allpass fractional delay (plucks, upright bass).
 * - `synth`   subtractive: polyBLEP saw/square, naive triangle or a detuned stereo supersaw → TPT SVF with its own
 *             envelope → ADSR → optional drive (bass, leads, arps, pads).
 * - `bell`    additive inharmonic partials (bell, mallet, glass).
 * - `sub`     sine sub bass / kick boom with a pitch drop and drive.
 * - `noise`   white/pink noise through a swept SVF with a pan sweep (hiss, brushes, whooshes, risers).
 * - `sample`  one-shot sampler: rate from semitones, 4-point Hermite interpolation, gates for choke groups, reverse.
 */
import { exp2, mtof, pow, sinTurns, tanh } from './dmath.ts';
import { Adsr, Svf, decayCoef, expInterp, onePoleCoef, panGains, type AdsrShape } from './dsp.ts';
import { mulberry32 } from './rng.ts';
import type { Stereo } from './types.ts';

export const BUSES = ['drums', 'bass', 'keys', 'lead', 'pads', 'fx'] as const;
export type BusName = (typeof BUSES)[number];

interface Base {
  /** Start, seconds. */
  t: number;
  bus: BusName;
  /** Linear gain. */
  gain: number;
  /** −1..1 */
  pan?: number;
  /** Free label for tests and stems (e.g. `land`). */
  tag?: string;
}

export interface SampleEvent extends Base {
  v: 'sample';
  id: string;
  /** Pitch shift in semitones (playback rate). */
  semi?: number;
  /** Hits in the same choke group cut each other (open/closed hats). */
  choke?: string;
  /** Maximum length in seconds (10 ms fade at the cut). */
  len?: number;
  /** Play the first `len` seconds backwards so the attack lands at `t + len` (reverse cymbal). */
  reverse?: boolean;
}

export interface EpianoEvent extends Base {
  v: 'epiano';
  midi: number;
  /** Key held, seconds (a 0.18 s release follows). */
  dur: number;
  /** 0..1, drives brightness. */
  vel: number;
}

export interface PluckEvent extends Base {
  v: 'pluck';
  midi: number;
  dur: number;
  vel: number;
  /** 0..1 excitation brightness. */
  bright?: number;
  /** T60 of the string, seconds. */
  decay?: number;
}

export interface SynthEvent extends Base {
  v: 'synth';
  midi: number;
  dur: number;
  vel: number;
  osc: 'saw' | 'square' | 'tri' | 'supersaw';
  /** Supersaw spread, cents (outermost voice). */
  detune?: number;
  /** Supersaw stereo width 0..1. */
  width?: number;
  /** Filter base cutoff, Hz. */
  cutoff: number;
  /** Filter Q. */
  reso?: number;
  /** Filter envelope depth in octaves (scaled by 0.5 + 0.5·vel). */
  envAmt?: number;
  fenv?: AdsrShape;
  amp: AdsrShape;
  /** Pulse width for `square`. */
  pw?: number;
  /** Start pitch for a portamento, and its time constant in seconds. */
  glideFrom?: number;
  glide?: number;
  /** tanh drive ≥ 1. */
  drive?: number;
  /** Octave-down sine mixed under the oscillator (0..1). */
  sub?: number;
}

export interface BellEvent extends Base {
  v: 'bell';
  midi: number;
  dur: number;
  vel: number;
  kind?: 'bell' | 'mallet' | 'glass';
}

export interface SubEvent extends Base {
  v: 'sub';
  midi: number;
  dur: number;
  /** Semitones above `midi` at the start, decaying with `dropTime` (kick/boom). */
  drop?: number;
  dropTime?: number;
  /** Seconds to release after `dur`. */
  release?: number;
  /** Amplitude decay T60 while held; omitted = sustain. */
  decay?: number;
  drive?: number;
}

export interface NoiseEvent extends Base {
  v: 'noise';
  dur: number;
  color?: 'white' | 'pink';
  filter: 'lp' | 'hp' | 'bp';
  /** Cutoff sweep from `f0` to `f1` (exponential) over `dur`. */
  f0: number;
  f1?: number;
  q?: number;
  /** Attack seconds (shape: `curve` power, 1 = linear, > 1 = late swell). */
  a: number;
  curve?: number;
  /** Release seconds at the end of `dur` (included in `dur`). */
  r: number;
  /** Pan at the end (linear sweep from `pan`). */
  panTo?: number;
  /** Seed salt so repeated events differ. */
  salt?: number;
}

export type MusicEvent = SampleEvent | EpianoEvent | PluckEvent | SynthEvent | BellEvent | SubEvent | NoiseEvent;

export interface Bus {
  l: Float64Array;
  r: Float64Array;
}

export interface VoiceContext {
  sr: number;
  seed: number;
  /** Prepared (gain + trim applied) one-shots. */
  sample(id: string): Stereo;
}

let scratch = new Float64Array(48000);
function mono(n: number): Float64Array {
  if (scratch.length < n) scratch = new Float64Array(n);
  scratch.fill(0, 0, n);
  return scratch;
}

/** Adds `n` mono samples into the bus at `start` with constant gain and pan. */
function emit(bus: Bus, start: number, x: Float64Array, n: number, gain: number, pan: number): void {
  const [gl, gr] = panGains(pan);
  const a = gain * gl;
  const b = gain * gr;
  const end = Math.min(n, bus.l.length - start);
  for (let i = 0; i < end; i++) {
    const v = x[i]!;
    bus.l[start + i]! += v * a;
    bus.r[start + i]! += v * b;
  }
}

/** Seed for an event: global seed × start sample, so identical hits at different times differ. */
const eventSeed = (ctx: VoiceContext, start: number, salt = 0) => (ctx.seed ^ Math.imul(start + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;

export function renderEvent(bus: Bus, e: MusicEvent, ctx: VoiceContext): void {
  const start = Math.round(e.t * ctx.sr);
  if (start >= bus.l.length || e.gain === 0) return;
  if (start < 0) throw new Error(`event at ${e.t} s starts before 0`);
  switch (e.v) {
    case 'sample':
      return sampler(bus, start, e, ctx);
    case 'epiano':
      return epiano(bus, start, e, ctx);
    case 'pluck':
      return pluck(bus, start, e, ctx);
    case 'synth':
      return e.osc === 'supersaw' ? supersaw(bus, start, e, ctx) : synth(bus, start, e, ctx);
    case 'bell':
      return bell(bus, start, e, ctx);
    case 'sub':
      return sub(bus, start, e, ctx);
    case 'noise':
      return noise(bus, start, e, ctx);
  }
}

// ─── Sampler ────────────────────────────────────────────────────────────────────────────────────────────────

/** 4-point, 3rd-order Hermite interpolation at `i + f`. */
function hermite(x: Float32Array, i: number, f: number): number {
  const n = x.length;
  const xm1 = i > 0 && i - 1 < n ? x[i - 1]! : 0;
  const x0 = i >= 0 && i < n ? x[i]! : 0;
  const x1 = i + 1 < n ? x[i + 1]! : 0;
  const x2 = i + 2 < n ? x[i + 2]! : 0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

function sampler(bus: Bus, start: number, e: SampleEvent, ctx: VoiceContext): void {
  const s = ctx.sample(e.id);
  const rate = (e.semi ? exp2(e.semi / 12) : 1) * (s.sampleRate / ctx.sr);
  const srcLen = s.l.length;
  let n = Math.floor((srcLen - 1) / rate) + 1;
  const cut = e.len !== undefined ? Math.max(1, Math.round(e.len * ctx.sr)) : n;
  const fade = Math.round(0.01 * ctx.sr);
  const gated = cut < n;
  if (gated) n = cut;
  n = Math.min(n, bus.l.length - start);
  const [gl, gr] = panGains(e.pan ?? 0);
  const a = e.gain * gl;
  const b = e.gain * gr;
  // Stereo samples keep their image; pan tilts it.
  for (let i = 0; i < n; i++) {
    const k = e.reverse ? cut - 1 - i : i;
    let vl: number;
    let vr: number;
    if (rate === 1) {
      vl = k < srcLen ? s.l[k]! : 0;
      vr = k < srcLen ? s.r[k]! : 0;
    } else {
      const p = k * rate;
      const j = Math.floor(p);
      const f = p - j;
      vl = hermite(s.l, j, f);
      vr = hermite(s.r, j, f);
    }
    let g = 1;
    if (gated && !e.reverse && i >= n - fade) g = (n - i) / fade;
    if (e.reverse && i < fade) g = (i + 1) / fade;
    bus.l[start + i]! += vl * a * g * 1.4142135623730951;
    bus.r[start + i]! += vr * b * g * 1.4142135623730951;
  }
}

// ─── FM electric piano ──────────────────────────────────────────────────────────────────────────────────────

function epiano(bus: Bus, start: number, e: EpianoEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const f = mtof(e.midi);
  const hold = Math.max(1, Math.round(e.dur * sr));
  const rel = Math.round(0.18 * sr);
  const n = Math.min(hold + rel, bus.l.length - start);
  const x = mono(n);
  const dc = f / sr;
  // Low notes ring longer; the tine (index) decays much faster than the body.
  const t60 = Math.min(6, Math.max(1.2, 2.4 * Math.sqrt(262 / f)));
  const body = decayCoef(t60, sr);
  const tineDecay = decayCoef(0.35 + 0.25 * (1 - e.vel), sr);
  const relC = decayCoef(0.18, sr);
  const index0 = 0.6 + 2.6 * e.vel * e.vel;
  const atk = Math.round(0.0015 * sr);
  let pc = 0;
  let pm = 0;
  let amp = 1;
  let tine = 1;
  const barkHz = f * 7;
  const bark = barkHz < sr * 0.45 ? 0.08 * e.vel : 0;
  let pb = 0;
  const db = barkHz / sr;
  const barkC = decayCoef(0.06, sr);
  let barkAmp = 1;
  for (let i = 0; i < n; i++) {
    const index = index0 * (0.18 + 0.82 * tine);
    const mod = sinTurns(pm) * index * 0.15915494309189535; // radians → turns
    let y = sinTurns(pc + mod) + bark * barkAmp * sinTurns(pb);
    const a = i < atk ? (i + 1) / atk : 1;
    if (i >= hold) amp *= relC;
    y *= amp * a;
    x[i] = y;
    amp *= body;
    tine *= tineDecay;
    barkAmp *= barkC;
    pc += dc;
    if (pc >= 1) pc -= 1;
    pm += dc;
    if (pm >= 1) pm -= 1;
    pb += db;
    if (pb >= 1) pb -= 1;
  }
  // Release tail reaches exactly zero.
  for (let i = Math.max(hold, n - 64); i < n; i++) x[i] = x[i]! * ((n - i) / 64 < 1 ? (n - i) / 64 : 1);
  emit(bus, start, x, n, e.gain, e.pan ?? 0);
}

// ─── Karplus–Strong ─────────────────────────────────────────────────────────────────────────────────────────

function pluck(bus: Bus, start: number, e: PluckEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const f = mtof(e.midi);
  const hold = Math.max(1, Math.round(e.dur * sr));
  const rel = Math.round(0.03 * sr);
  const n = Math.min(hold + rel, bus.l.length - start);
  const x = mono(n);
  const D = sr / f - 0.5; // the two-point average adds half a sample
  let Di = Math.floor(D);
  let frac = D - Di;
  if (frac < 0.1) {
    Di -= 1;
    frac += 1;
  }
  const C = (1 - frac) / (1 + frac);
  const rho = decayCoef(e.decay ?? 2, f); // loss per period
  const buf = new Float64Array(Di);
  const rnd = mulberry32(eventSeed(ctx, start, 1));
  const bright = e.bright ?? 0.6;
  const lpA = onePoleCoef(200 + 12000 * bright * (0.4 + 0.6 * e.vel), sr);
  let z = 0;
  let mean = 0;
  for (let i = 0; i < Di; i++) {
    z += lpA * (rnd() * 2 - 1 - z);
    buf[i] = z;
    mean += z;
  }
  mean /= Di;
  for (let i = 0; i < Di; i++) buf[i] = buf[i]! - mean;
  let idx = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  for (let i = 0; i < n; i++) {
    const y = buf[idx]!;
    const avg = 0.5 * (y + prev) * rho;
    prev = y;
    const ap = C * avg + apX - C * apY; // first-order allpass for the fractional delay
    apX = avg;
    apY = ap;
    buf[idx] = ap;
    if (++idx === Di) idx = 0;
    const g = i >= hold ? (n - i) / rel : 1;
    x[i] = y * g;
  }
  emit(bus, start, x, n, e.gain * (0.5 + 0.5 * e.vel), e.pan ?? 0);
}

// ─── Subtractive synth ──────────────────────────────────────────────────────────────────────────────────────

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const u = t / dt;
    return u + u - u * u - 1;
  }
  if (t > 1 - dt) {
    const u = (t - 1) / dt;
    return u * u + u + u + 1;
  }
  return 0;
}

const BLOCK = 16;

function synth(bus: Bus, start: number, e: SynthEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const hold = Math.max(1, Math.round(e.dur * sr));
  const amp = new Adsr(e.amp, hold, sr);
  const fenv = new Adsr(e.fenv ?? e.amp, hold, sr);
  const n = Math.min(amp.length, bus.l.length - start);
  const x = mono(n);
  const svf = new Svf(sr, e.cutoff, e.reso ?? 0.707);
  const envAmt = (e.envAmt ?? 0) * (0.5 + 0.5 * e.vel);
  // Portamento: the pitch offset decays by 60 dB over `glide`, updated once per block.
  const glideC = e.glideFrom !== undefined ? decayCoef(e.glide ?? 0.05, sr / BLOCK) : 0;
  let pitch = e.glideFrom !== undefined ? e.glideFrom : e.midi;
  let dt = mtof(pitch) / sr;
  const pw = e.pw ?? 0.5;
  const drive = e.drive ?? 1;
  const subMix = e.sub ?? 0;
  let ph = 0;
  let phSub = 0;
  for (let i = 0; i < n; i++) {
    const fe = fenv.next();
    if (i % BLOCK === 0) {
      if (glideC) {
        dt = mtof(pitch) / sr;
        pitch = e.midi + (pitch - e.midi) * glideC;
      }
      svf.set(e.cutoff * exp2(envAmt * fe), e.reso ?? 0.707);
    }
    let y: number;
    if (e.osc === 'saw') y = 2 * ph - 1 - polyBlep(ph, dt);
    else if (e.osc === 'square') {
      let q = ph - pw;
      if (q < 0) q += 1;
      y = (ph < pw ? 1 : -1) + polyBlep(ph, dt) - polyBlep(q, dt);
    } else y = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
    if (subMix) y += subMix * sinTurns(phSub);
    ph += dt;
    if (ph >= 1) ph -= 1;
    phSub += dt * 0.5;
    if (phSub >= 1) phSub -= 1;
    let v = svf.process(y) * amp.next();
    if (drive > 1) v = tanh(v * drive) / drive;
    x[i] = v;
  }
  emit(bus, start, x, n, e.gain * (0.4 + 0.6 * e.vel), e.pan ?? 0);
}

const SUPER = [-1, -0.62, -0.31, 0, 0.29, 0.6, 0.97];

function supersaw(bus: Bus, start: number, e: SynthEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const hold = Math.max(1, Math.round(e.dur * sr));
  const amp = new Adsr(e.amp, hold, sr);
  const fenv = new Adsr(e.fenv ?? e.amp, hold, sr);
  const n = Math.min(amp.length, bus.l.length - start);
  const f = mtof(e.midi);
  const detune = e.detune ?? 25;
  const width = e.width ?? 0.8;
  const rnd = mulberry32(eventSeed(ctx, start, Math.round(e.midi * 16)));
  const dts = SUPER.map((d) => (f * exp2((d * detune) / 1200)) / sr);
  const phs = SUPER.map(() => rnd());
  const gl = SUPER.map((d) => panGains(d * width)[0] * 0.5);
  const gr = SUPER.map((d) => panGains(d * width)[1] * 0.5);
  const sl = new Svf(sr, e.cutoff, e.reso ?? 0.707);
  const sR = new Svf(sr, e.cutoff, e.reso ?? 0.707);
  const envAmt = (e.envAmt ?? 0) * (0.5 + 0.5 * e.vel);
  const [pl, pr] = panGains(e.pan ?? 0);
  const g = e.gain * (0.4 + 0.6 * e.vel) * 1.4142135623730951;
  const end = start + n;
  for (let i = start, k = 0; i < end; i++, k++) {
    const fe = fenv.next();
    if (k % BLOCK === 0) {
      const fc = e.cutoff * exp2(envAmt * fe);
      sl.set(fc, e.reso ?? 0.707);
      sR.set(fc, e.reso ?? 0.707);
    }
    let yl = 0;
    let yr = 0;
    for (let v = 0; v < 7; v++) {
      const dt = dts[v]!;
      let p = phs[v]!;
      const s = 2 * p - 1 - polyBlep(p, dt);
      p += dt;
      if (p >= 1) p -= 1;
      phs[v] = p;
      yl += s * gl[v]!;
      yr += s * gr[v]!;
    }
    const a = amp.next() * g;
    bus.l[i]! += sl.process(yl) * a * pl;
    bus.r[i]! += sR.process(yr) * a * pr;
  }
}

// ─── Bells and mallets ──────────────────────────────────────────────────────────────────────────────────────

/** [frequency ratio, amplitude, T60 seconds at 440 Hz]. */
const PARTIALS: Record<NonNullable<BellEvent['kind']>, [number, number, number][]> = {
  bell: [
    [0.5, 0.25, 3.2],
    [1, 1, 2.4],
    [1.19, 0.3, 1.6],
    [2, 0.45, 1.1],
    [2.76, 0.32, 0.8],
    [5.4, 0.14, 0.35],
    [8.93, 0.06, 0.18],
  ],
  mallet: [
    [1, 1, 1.4],
    [3.93, 0.22, 0.35],
    [9.54, 0.05, 0.08],
  ],
  glass: [
    [1, 1, 1.2],
    [2.32, 0.4, 0.7],
    [4.25, 0.25, 0.4],
    [6.63, 0.12, 0.2],
  ],
};

function bell(bus: Bus, start: number, e: BellEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const f = mtof(e.midi);
  const hold = Math.max(1, Math.round(e.dur * sr));
  const rel = Math.round(0.05 * sr);
  const n = Math.min(hold + rel, bus.l.length - start);
  const x = mono(n);
  const scale = Math.sqrt(440 / f);
  const atk = Math.round(0.001 * sr);
  for (const [ratio, a0, t60] of PARTIALS[e.kind ?? 'bell']) {
    const fr = f * ratio;
    if (fr >= sr * 0.45) continue;
    const amp0 = a0 * (ratio > 1.5 ? 0.35 + 0.65 * e.vel : 1);
    const c = decayCoef(Math.min(t60 * scale, 8), sr);
    const dp = fr / sr;
    let p = 0;
    let a = amp0;
    for (let i = 0; i < n; i++) {
      x[i]! += sinTurns(p) * a;
      a *= c;
      p += dp;
      if (p >= 1) p -= 1;
    }
  }
  for (let i = 0; i < atk && i < n; i++) x[i] = x[i]! * ((i + 1) / atk);
  for (let i = hold; i < n; i++) x[i] = x[i]! * ((n - i) / rel);
  emit(bus, start, x, n, e.gain * (0.3 + 0.7 * e.vel) * 0.5, e.pan ?? 0);
}

// ─── Sub bass / boom ────────────────────────────────────────────────────────────────────────────────────────

function sub(bus: Bus, start: number, e: SubEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const hold = Math.max(1, Math.round(e.dur * sr));
  const rel = Math.max(1, Math.round((e.release ?? 0.06) * sr));
  const n = Math.min(hold + rel, bus.l.length - start);
  const x = mono(n);
  const atk = Math.round(0.002 * sr);
  const dropC = e.drop ? decayCoef(e.dropTime ?? 0.05, sr / BLOCK) : 0;
  const decay = e.decay !== undefined ? decayCoef(e.decay, sr) : 1;
  const drive = e.drive ?? 1;
  const norm = drive > 1 ? 1 / tanh(drive) : 1;
  let semis = e.drop ?? 0;
  let f = mtof(e.midi + semis);
  let p = 0;
  let a = 1;
  for (let i = 0; i < n; i++) {
    if (dropC && i % BLOCK === 0) {
      f = mtof(e.midi + semis);
      semis *= dropC;
    }
    let y = sinTurns(p) * a;
    if (drive > 1) y = tanh(y * drive) * norm;
    const env = i < atk ? (i + 1) / atk : i >= hold ? (n - i) / rel : 1;
    x[i] = y * env;
    a *= decay;
    p += f / sr;
    if (p >= 1) p -= 1;
  }
  emit(bus, start, x, n, e.gain, e.pan ?? 0);
}

// ─── Noise ──────────────────────────────────────────────────────────────────────────────────────────────────

function noise(bus: Bus, start: number, e: NoiseEvent, ctx: VoiceContext): void {
  const sr = ctx.sr;
  const n = Math.min(Math.max(1, Math.round(e.dur * sr)), bus.l.length - start);
  const rnd = mulberry32(eventSeed(ctx, start, e.salt ?? 0));
  const svf = new Svf(sr, e.f0, e.q ?? 0.707);
  const aLen = Math.max(1, Math.round(e.a * sr));
  const rLen = Math.max(1, Math.round(e.r * sr));
  const curve = e.curve ?? 1;
  const f1 = e.f1 ?? e.f0;
  const p0 = e.pan ?? 0;
  const p1 = e.panTo ?? p0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let gl = 0;
  let gr = 0;
  for (let i = 0; i < n; i++) {
    if (i % BLOCK === 0) {
      const u = i / n;
      svf.set(f1 === e.f0 ? e.f0 : expInterp(e.f0, f1, u), e.q ?? 0.707);
      [gl, gr] = panGains(p0 + (p1 - p0) * u);
    }
    let w = rnd() * 2 - 1;
    if (e.color === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      w = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
    svf.process(w);
    const y = e.filter === 'lp' ? svf.lp : e.filter === 'hp' ? svf.hp : svf.bp;
    let env = 1;
    if (i < aLen) {
      const u = (i + 1) / aLen;
      env = curve === 1 ? u : pow(u, curve);
    }
    if (i >= n - rLen) env *= (n - i) / rLen;
    const v = y * env * e.gain;
    bus.l[start + i]! += v * gl;
    bus.r[start + i]! += v * gr;
  }
}
