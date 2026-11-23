/**
 * Deterministic oscillator/noise note synthesiser: a pure-TypeScript port of OpenKatana's `synthesize_score`
 * (openkatana/production.py). Same document schema and validation rules. Browser-safe: no Node imports.
 *
 * Determinism: notes are summed in document order into one Float64 buffer, so the output depends only on the
 * document. Noise comes from a seeded mulberry32 + Box–Muller generator (numpy's PCG64 stream is not reproduced).
 * All trigonometry and exponentials go through `dmath`, so Node and the browser produce identical samples.
 */
import { PI, cos, exp, mtof, sin } from './dmath.ts';
import { gaussian } from './rng.ts';

export const WAVEFORMS = ['sine', 'triangle', 'bell', 'noise'] as const;
export type Waveform = (typeof WAVEFORMS)[number];

export interface NoteEvent {
  at: number;
  duration: number;
  midi?: number;
  gain?: number;
  waveform?: Waveform;
  pan?: number;
  attack?: number;
  release?: number;
}

export interface ScoreDocument {
  duration: number;
  sample_rate?: number;
  seed?: number;
  notes: NoteEvent[];
}

export interface SynthResult {
  /** Interleaved stereo (L, R), normalised so the peak is ≤ 0.95. */
  mix: Float64Array;
  sampleRate: number;
  /** Frames per channel: `round(duration · sampleRate)`. */
  samples: number;
  /** Peak |sample| after normalisation. */
  peak: number;
  /** Gain applied to reach the 0.95 peak (≤ 1). */
  normalization: number;
}

export class ScoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoreError';
  }
}

const DOC_FIELDS: Record<string, true> = { duration: true, sample_rate: true, seed: true, notes: true };
const NOTE_FIELDS: Record<string, true> = {
  at: true,
  duration: true,
  midi: true,
  gain: true,
  waveform: true,
  pan: true,
  attack: true,
  release: true,
};

function fields(value: unknown, allowed: Record<string, true>, where: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ScoreError(`${where}: expected an object`);
  const unknown = Object.keys(value).filter((k) => !Object.hasOwn(allowed, k)).sort();
  if (unknown.length) throw new ScoreError(`${where}: unsupported fields: ${unknown.join(', ')}`);
}

function number(value: unknown, where: string, low: number, high: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ScoreError(`${where}: expected a finite number`);
  if (integer && !Number.isInteger(value)) throw new ScoreError(`${where}: expected an integer`);
  if (value < low || value > high) throw new ScoreError(`${where}: out of range`);
  return value;
}

const TABLE = 4096;
const triangleTables = new Map<number, Float64Array>();

/** One cycle of the band-limited triangle with odd harmonics 1..maxH, plus a guard sample for interpolation. */
function triangleTable(maxH: number): Float64Array {
  let table = triangleTables.get(maxH);
  if (table) return table;
  table = new Float64Array(TABLE + 1);
  const k = 8 / (PI * PI);
  for (let i = 0; i < TABLE; i++) {
    const phase = (2 * PI * i) / TABLE;
    let s = 0;
    for (let h = 1; h <= maxH; h += 2) s += ((((h - 1) >> 1) & 1 ? -1 : 1) * sin(h * phase)) / (h * h);
    table[i] = s * k;
  }
  table[TABLE] = table[0]!;
  triangleTables.set(maxH, table);
  return table;
}

interface Prepared {
  at: number;
  length: number;
  freq: number;
  gain: number;
  pan: number;
  attack: number;
  release: number;
  kind: Waveform;
}

function prepare(document: unknown): { duration: number; sr: number; seed: number; notes: Prepared[] } {
  fields(document, DOC_FIELDS, 'score');
  const duration = number(document.duration, 'duration', 0.05, 180);
  const sr = number(document.sample_rate ?? 48000, 'sample_rate', 8000, 96000, true);
  const seed = number(document.seed ?? 0, 'seed', 0, 2 ** 32 - 1, true);
  const notes = document.notes;
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 10000) throw new ScoreError('Supply 1..10000 note events');
  const prepared: Prepared[] = [];
  for (const event of notes as unknown[]) {
    fields(event, NOTE_FIELDS, 'note');
    const at = number(event.at, 'at', 0, duration);
    const length = number(event.duration, 'note duration', 0.005, duration);
    if (at + length > duration + 1e-9) throw new ScoreError('Note exceeds score duration');
    const midi = number(event.midi ?? 60, 'midi', 0, 127);
    const gain = number(event.gain ?? 0.2, 'gain', 0, 1);
    const pan = number(event.pan ?? 0, 'pan', -1, 1);
    const attack = number(event.attack ?? Math.min(0.01, length / 4), 'attack', 0, length);
    const release = number(event.release ?? Math.min(0.05, length / 4), 'release', 0, length);
    if (attack + release > length) throw new ScoreError('Attack and release exceed note duration');
    const kind = event.waveform ?? 'sine';
    if (!(WAVEFORMS as readonly unknown[]).includes(kind)) throw new ScoreError('Unsupported oscillator');
    const freq = mtof(midi);
    if (kind !== 'noise' && freq * (kind === 'bell' ? 2 : 1) >= sr / 2) throw new ScoreError('Note exceeds oscillator Nyquist limit');
    prepared.push({ at, length, freq, gain, pan, attack, release, kind: kind as Waveform });
  }
  return { duration, sr, seed, notes: prepared };
}

/** Validates the document and renders it. Throws `ScoreError` on contract violations. */
export function synthesize(document: ScoreDocument): SynthResult {
  const { duration, sr, seed, notes } = prepare(document);
  const frames = Math.round(duration * sr);
  const mix = new Float64Array(frames * 2);
  const normal = gaussian(seed);
  let signal = new Float64Array(0);
  const TWO_PI = 2 * PI;

  for (const { at, length, freq, gain, pan, attack, release, kind } of notes) {
    const start = Math.round(at * sr);
    const n = Math.max(0, Math.min(Math.round(length * sr), frames - start));
    if (n === 0) continue;
    if (signal.length < n) signal = new Float64Array(n);

    // Oscillator.
    if (kind === 'sine') {
      const w = (TWO_PI * freq) / sr;
      for (let i = 0; i < n; i++) signal[i] = sin(w * i);
    } else if (kind === 'triangle') {
      const table = triangleTable(Math.min(63, Math.floor((sr / 2 - 1e-9) / freq)));
      const step = freq / sr; // cycles per sample
      for (let i = 0; i < n; i++) {
        const c = step * i;
        const x = (c - Math.floor(c)) * TABLE;
        const j = Math.floor(x);
        const a = table[j]!;
        signal[i] = a + (table[j + 1]! - a) * (x - j);
      }
    } else if (kind === 'bell') {
      const w = (TWO_PI * freq) / sr;
      const decay = -5 / (length * sr);
      for (let i = 0; i < n; i++) {
        const p = w * i;
        signal[i] = (sin(p) + 0.35 * sin(2 * p)) * exp(decay * i);
      }
    } else {
      for (let i = 0; i < n; i++) signal[i] = normal() * 0.25;
    }

    // Linear attack/release (np.linspace semantics: endpoints included).
    const a = Math.min(n, Math.round(attack * sr));
    const r = Math.min(n - a, Math.round(release * sr));
    for (let i = 0; i < a; i++) signal[i]! *= a > 1 ? i / (a - 1) : 0;
    for (let j = 0, i = n - r; j < r; j++, i++) signal[i]! *= r > 1 ? 1 - j / (r - 1) : 1;

    // Equal-power pan, summed in note order.
    const angle = ((pan + 1) * PI) / 4;
    const gl = gain * cos(angle);
    const gr = gain * sin(angle);
    for (let i = 0, o = start * 2; i < n; i++, o += 2) {
      const s = signal[i]!;
      mix[o]! += s * gl;
      mix[o + 1]! += s * gr;
    }
  }

  let peak = 0;
  for (let i = 0; i < mix.length; i++) {
    const v = Math.abs(mix[i]!);
    if (v > peak) peak = v;
  }
  const normalization = Math.min(1, 0.95 / Math.max(peak, 1e-12));
  for (let i = 0; i < mix.length; i++) mix[i]! *= normalization;
  return { mix, sampleRate: sr, samples: frames, peak: peak * normalization, normalization };
}
