/**
 * `@reel/audio` (PLAN.md §8.2): a deterministic DSP engine that runs bit-identically in Node and the browser.
 *
 * Music: a preset turns a cue sheet into an arrangement (events on six buses), the engine renders it to a stem.
 * SFX: sound cues from the page render to a second stem. `mix` sums stems in a fixed order, `master` limits the bus
 * and sets the final peak, `encodeWav` writes PCM for ffmpeg's loudnorm/AAC.
 */
import type { CueSheet } from '@reel/core';
import { dbToGain, gainToDb } from './dmath.ts';
import { limit, loudness, truePeak } from './dynamics.ts';
import { renderArrangement } from './engine.ts';
import { acousticFolk } from './presets/acoustic-folk.ts';
import { ambientDrift } from './presets/ambient-drift.ts';
import { chiptune } from './presets/chiptune.ts';
import { cinematicPulse } from './presets/cinematic-pulse.ts';
import { funkDisco } from './presets/funk-disco.ts';
import { house128 } from './presets/house-128.ts';
import { lofiJazz } from './presets/lofi-jazz.ts';
import { minimalPop } from './presets/minimal-pop.ts';
import type { Preset } from './presets/plan.ts';
import { synthwaveDrive } from './presets/synthwave-drive.ts';
import { trap808 } from './presets/trap-808.ts';
import { kitSample } from './samples.ts';
import { SAMPLE_RATE, type SampleBank, type Stereo } from './types.ts';

export * as dmath from './dmath.ts';
export { computeEnvelopes } from './envelope.ts';
export { renderSfx, type SfxOptions } from './sfx.ts';
export { SAMPLE_MANIFEST } from './samples.ts';
export { decodeWav, encodeWav } from './wav.ts';
export { resample } from './resample.ts';
export { mulberry32 } from './rng.ts';
export { limit, compress, duck, loudness, truePeak, type LimitOptions, type CompressorOptions, type DuckOptions } from './dynamics.ts';
export { renderArrangement, type Arrangement, type BusSettings } from './engine.ts';
export { BUSES, type BusName, type MusicEvent } from './voices.ts';
export { synthesize, ScoreError, WAVEFORMS } from './synth.ts';
export type { NoteEvent, ScoreDocument, SynthResult, Waveform } from './synth.ts';
export type { Preset, PresetMusic } from './presets/plan.ts';
export type { SampleBank, SampleEntry, Stereo } from './types.ts';

const PRESETS: Record<string, Preset> = {
  'lofi-jazz': lofiJazz,
  'synthwave-drive': synthwaveDrive,
  'minimal-pop': minimalPop,
  'house-128': house128,
  'trap-808': trap808,
  'cinematic-pulse': cinematicPulse,
  chiptune,
  'acoustic-folk': acousticFolk,
  'ambient-drift': ambientDrift,
  'funk-disco': funkDisco,
};

export const MUSIC_PRESETS: string[] = Object.keys(PRESETS);

/** Design tempo range of each preset (they render at any tempo). */
export const PRESET_BPM: Record<string, [number, number]> = Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, p.bpm]));

/** Tempo each preset starts at in the studio (and is demoed and tested at). */
export const PRESET_DEFAULT_BPM: Record<string, number> = Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, p.defaultBpm]));

/** Catalog entries for the music cards, in registry order. */
export const PRESET_INFO: { id: string; name: string; description: string; bpm: [number, number]; defaultBpm: number }[] = Object.entries(PRESETS).map(
  ([id, p]) => ({ id, name: p.name, description: p.description, bpm: p.bpm, defaultBpm: p.defaultBpm }),
);

function preset(id: string): Preset {
  const p = PRESETS[id];
  if (!p) throw new Error(`unknown music preset "${id}" (known: ${MUSIC_PRESETS.join(', ')})`);
  return p;
}

/** The arrangement a preset writes for this cue sheet (what `renderMusic` renders). */
export function musicArrangement(sheet: CueSheet, music: { preset: string; bpm: number; seed: number }) {
  return preset(music.preset).arrange(sheet, { bpm: music.bpm, seed: music.seed });
}

/** Renders the music stem: `round(duration · sr)` frames, levelled to ≈ −20 dBFS RMS. Deterministic. */
export function renderMusic(
  sheet: CueSheet,
  music: { preset: string; bpm: number; seed: number },
  opts: { samples: SampleBank; sampleRate?: number },
): Stereo & { notes: number } {
  const a = musicArrangement(sheet, music);
  const out = renderArrangement(a, {
    sampleRate: opts.sampleRate ?? SAMPLE_RATE,
    seed: music.seed >>> 0,
    sample: (id) => kitSample(opts.samples, id),
  });
  return { ...out, notes: a.events.length };
}

/** Sums stems in array order with fixed gains into `round(duration · 48 kHz)` frames. No normalisation. */
export function mix(stems: { audio: Stereo; gain: number }[], duration: number): Stereo {
  const sr = stems[0]?.audio.sampleRate ?? SAMPLE_RATE;
  const frames = Math.round(duration * sr);
  const l = new Float64Array(frames);
  const r = new Float64Array(frames);
  for (const { audio, gain } of stems) {
    if (audio.sampleRate !== sr) throw new Error(`stem sample rates differ: ${audio.sampleRate} vs ${sr}`);
    const n = Math.min(frames, audio.l.length);
    for (let i = 0; i < n; i++) {
      l[i]! += audio.l[i]! * gain;
      r[i]! += audio.r[i]! * gain;
    }
  }
  return { l: Float32Array.from(l), r: Float32Array.from(r), sampleRate: sr };
}

/** Final sample peak of every master. */
const PEAK = 0.95;
/**
 * Largest true peak − integrated loudness (dB) a master leaves. ffmpeg `loudnorm` stays linear (no dynamic pumping)
 * when true peak − I ≤ 12.5 dB at −14 LUFS / −1.5 dBTP; 10.5 keeps a 2 dB margin.
 */
export const MAX_CREST_DB = 10.5;

const peakOf = (l: Float64Array, r: Float64Array) => {
  let p = 0;
  for (let i = 0; i < l.length; i++) p = Math.max(p, Math.abs(l[i]!), Math.abs(r[i]!));
  return p;
};

/**
 * Master bus: the M1 look-ahead limiter with `ceiling` as a fraction of the input peak (default 0.6 ≈ −4.4 dB of
 * peak reduction), tightened when needed so the true peak (4× oversampled) sits at most `MAX_CREST_DB` above the
 * integrated loudness (BS.1770); then a gain so the sample peak is exactly ≤ 0.95. Silence stays silence.
 */
export function master(x: Stereo, o: { ceiling?: number } = {}): Stereo {
  const sr = x.sampleRate;
  const l = Float64Array.from(x.l);
  const r = Float64Array.from(x.r);
  let ceiling = o.ceiling ?? 0.6;
  // Limiting lowers the loudness too, so re-measure and tighten; aim 0.2 dB under the cap so it converges in 1–3 passes.
  for (let pass = 0; pass < 5; pass++) {
    const lufs = loudness(l, r, sr);
    if (lufs > -Infinity) {
      const tp = truePeak(l, r);
      const crest = gainToDb(tp) - lufs;
      if (pass > 0 && crest <= MAX_CREST_DB) break;
      // The limiter's ceiling is relative to the sample peak; true peak scales with it.
      ceiling = Math.min(ceiling, dbToGain(MAX_CREST_DB - 0.2 - crest));
    }
    if (ceiling >= 0.999) break;
    limit(l, r, sr, { ceiling, lookahead: 0.005, release: 0.15 });
    ceiling = 1;
  }
  const peak = peakOf(l, r);
  const k = peak > 0 ? PEAK / peak : 0;
  const ol = new Float32Array(l.length);
  const or = new Float32Array(r.length);
  for (let i = 0; i < l.length; i++) {
    ol[i] = l[i]! * k;
    or[i] = r[i]! * k;
  }
  return { l: ol, r: or, sampleRate: sr };
}
