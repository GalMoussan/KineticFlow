/**
 * The mixer engine: renders an arrangement (events + bus settings) to a stereo stem.
 *
 * Fixed processing order, so the output depends only on the arrangement:
 * 1. events, stably sorted by start, render into their bus (drums, bass, keys, lead, pads, fx);
 * 2. each bus runs its inserts: HP → LP → EQ → drive → compressor → chorus → kick duck → width → gain;
 * 3. buses feed one shared delay and one shared reverb (the delay also feeds the reverb) in bus order;
 * 4. sum = buses in order + delay return + reverb return → glue compressor → final fade → optional RMS level.
 */
import { compress, duck, type CompressorOptions, type DuckOptions } from './dynamics.ts';
import { cosTurns, dbToGain, tanh } from './dmath.ts';
import { Biquad, type BiquadType } from './dsp.ts';
import { chorus, delay, reverb, type ChorusOptions, type DelayOptions, type ReverbOptions } from './effects.ts';
import type { Stereo } from './types.ts';
import { BUSES, renderEvent, type Bus, type BusName, type MusicEvent, type VoiceContext } from './voices.ts';

export interface BusSettings {
  /** Linear fader. */
  gain: number;
  /** Send levels to the shared reverb / delay. */
  reverb?: number;
  delay?: number;
  /** High-/low-pass corner, Hz. */
  hp?: number;
  lp?: number;
  eq?: { type: BiquadType; f: number; q?: number; db?: number }[];
  /** tanh drive ≥ 1 (gain-compensated). */
  drive?: number;
  comp?: CompressorOptions;
  chorus?: ChorusOptions;
  /** Pump on every `Arrangement.kicks` time. */
  duck?: DuckOptions;
  /** Stereo width: 0 = mono, 1 = as is, > 1 = wider. */
  width?: number;
}

export interface Arrangement {
  duration: number;
  events: MusicEvent[];
  buses: Partial<Record<BusName, BusSettings>>;
  /** Sidechain triggers (seconds), usually the kicks. */
  kicks: number[];
  reverb: ReverbOptions & { gain: number };
  delay: DelayOptions & { gain: number; /** Delay → reverb send. */ reverb?: number };
  glue?: CompressorOptions;
  /** Cosine fade to silence over [from, to] seconds; silence after. */
  fade?: { from: number; to: number };
  /** Normalise the stem to this RMS (dBFS, both channels); omitted = absolute levels. */
  rmsDb?: number;
}

export interface RenderContext {
  sampleRate: number;
  seed: number;
  sample: VoiceContext['sample'];
}

/** Gates sample hits that share a choke group: each one ends where the next starts. Returns a new list. */
function applyChokes(events: MusicEvent[]): MusicEvent[] {
  const next = new Map<string, number>();
  const out = events.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const e = out[i]!;
    if (e.v !== 'sample' || !e.choke) continue;
    const later = next.get(e.choke);
    if (later !== undefined && later > e.t) {
      const len = later - e.t;
      out[i] = { ...e, len: e.len === undefined ? len : Math.min(e.len, len) };
    }
    next.set(e.choke, e.t);
  }
  return out;
}

function inserts(bus: Bus, s: BusSettings, kicks: number[], sr: number): void {
  const { l, r } = bus;
  const n = l.length;
  const filters: Biquad[][] = [];
  if (s.hp) filters.push([new Biquad('hp', s.hp, sr), new Biquad('hp', s.hp, sr)]);
  if (s.lp) filters.push([new Biquad('lp', s.lp, sr), new Biquad('lp', s.lp, sr)]);
  for (const q of s.eq ?? []) filters.push([0, 1].map(() => new Biquad(q.type, q.f, sr, q.q ?? 0.707, q.db ?? 0)));
  for (const [fl, fr] of filters) {
    fl!.run(l);
    fr!.run(r);
  }
  if (s.drive && s.drive > 1) {
    const d = s.drive;
    for (let i = 0; i < n; i++) {
      l[i] = tanh(l[i]! * d) / d;
      r[i] = tanh(r[i]! * d) / d;
    }
  }
  if (s.comp) compress(l, r, s.comp, sr);
  if (s.chorus) chorus(l, r, s.chorus, sr);
  if (s.duck) duck(l, r, kicks.map((t) => Math.round(t * sr)), s.duck, sr);
  const w = s.width ?? 1;
  const g = s.gain;
  for (let i = 0; i < n; i++) {
    const m = (l[i]! + r[i]!) * 0.5;
    const d = (l[i]! - r[i]!) * 0.5 * w;
    l[i] = (m + d) * g;
    r[i] = (m - d) * g;
  }
}

export function renderArrangement(a: Arrangement, ctx: RenderContext): Stereo {
  const sr = ctx.sampleRate;
  const frames = Math.round(a.duration * sr);
  const order = a.events.map((e, i) => [e, i] as const).sort((x, y) => x[0].t - y[0].t || x[1] - y[1]);
  const events = applyChokes(order.map(([e]) => e));
  const vctx: VoiceContext = { sr, seed: ctx.seed, sample: ctx.sample };

  const sendRevL = new Float64Array(frames);
  const sendRevR = new Float64Array(frames);
  const sendDelL = new Float64Array(frames);
  const sendDelR = new Float64Array(frames);
  const sumL = new Float64Array(frames);
  const sumR = new Float64Array(frames);
  let usesRev = false;
  let usesDel = false;
  const bus: Bus = { l: new Float64Array(frames), r: new Float64Array(frames) };

  for (const name of BUSES) {
    const s = a.buses[name];
    if (!s) {
      if (events.some((e) => e.bus === name)) throw new Error(`events on bus "${name}" but the arrangement has no settings for it`);
      continue;
    }
    bus.l.fill(0);
    bus.r.fill(0);
    let any = false;
    for (const e of events) {
      if (e.bus !== name) continue;
      renderEvent(bus, e, vctx);
      any = true;
    }
    if (!any) continue;
    inserts(bus, s, a.kicks, sr);
    const rv = s.reverb ?? 0;
    const dl = s.delay ?? 0;
    usesRev ||= rv > 0;
    usesDel ||= dl > 0;
    for (let i = 0; i < frames; i++) {
      const x = bus.l[i]!;
      const y = bus.r[i]!;
      sumL[i]! += x;
      sumR[i]! += y;
      if (rv) {
        sendRevL[i]! += x * rv;
        sendRevR[i]! += y * rv;
      }
      if (dl) {
        sendDelL[i]! += x * dl;
        sendDelR[i]! += y * dl;
      }
    }
  }

  if (usesDel) {
    const outL = new Float64Array(frames);
    const outR = new Float64Array(frames);
    delay(sendDelL, sendDelR, outL, outR, a.delay, sr);
    const toRev = a.delay.reverb ?? 0;
    usesRev ||= toRev > 0;
    for (let i = 0; i < frames; i++) {
      sumL[i]! += outL[i]! * a.delay.gain;
      sumR[i]! += outR[i]! * a.delay.gain;
      sendRevL[i]! += outL[i]! * toRev;
      sendRevR[i]! += outR[i]! * toRev;
    }
  }
  if (usesRev) {
    const outL = new Float64Array(frames);
    const outR = new Float64Array(frames);
    reverb(sendRevL, sendRevR, outL, outR, a.reverb, sr);
    for (let i = 0; i < frames; i++) {
      sumL[i]! += outL[i]! * a.reverb.gain;
      sumR[i]! += outR[i]! * a.reverb.gain;
    }
  }

  if (a.glue) compress(sumL, sumR, a.glue, sr);
  if (a.fade) {
    const from = Math.round(a.fade.from * sr);
    const to = Math.round(a.fade.to * sr);
    for (let i = Math.max(0, from); i < frames; i++) {
      const g = i >= to ? 0 : 0.5 + 0.5 * cosTurns((0.5 * (i - from)) / (to - from));
      sumL[i] = sumL[i]! * g;
      sumR[i] = sumR[i]! * g;
    }
  }
  if (a.rmsDb !== undefined) {
    let ss = 0;
    for (let i = 0; i < frames; i++) ss += sumL[i]! * sumL[i]! + sumR[i]! * sumR[i]!;
    const rms = Math.sqrt(ss / Math.max(1, 2 * frames));
    if (rms > 0) {
      const g = dbToGain(a.rmsDb) / rms;
      for (let i = 0; i < frames; i++) {
        sumL[i] = sumL[i]! * g;
        sumR[i] = sumR[i]! * g;
      }
    }
  }
  return { l: Float32Array.from(sumL), r: Float32Array.from(sumR), sampleRate: sr };
}
